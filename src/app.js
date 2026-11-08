const express = require('express');
const path = require('path');
const { createStore } = require('./store');
const { createPayPal } = require('./paypal');
const { createProvider, runAgent, intakeMessage } = require('./agent');
const { summary, effectiveStatus, clientInsights, reminderMessage, timeSaved } = require('./agent/tools');
const { seedDemo } = require('./seed');
const { matchPayments } = require('./reconcile');

function createApp(config, { store = createStore(config.dataFile), paypal, provider } = {}) {
  paypal = paypal || createPayPal(config.paypal, { demo: config.paypalDemo });
  provider = provider || createProvider(config);
  const app = express();
  app.use(express.json({ limit: '200kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  let chatHistory = [];

  const view = () => ({
    invoices: store.db.invoices.map((i) => ({ ...i, status: effectiveStatus(i) })),
    payouts: store.db.payouts || [],
    pending: store.db.pending.filter((p) => p.status === 'PENDING'),
    audit: store.db.audit.slice(0, 100),
    summary: { ...summary(store.db.invoices), minutesSaved: timeSaved(store.db.audit) },
    insights: clientInsights(store.db.invoices),
    reconcile: store.db.lastReconcile || null,
  });

  // Search PayPal for incoming payments, match them to open invoices, and queue each match as an
  // approval card ("record payment"). Nothing is marked paid without a human click.
  async function reconcile() {
    const { transactions, lastRefreshed } = await paypal.searchTransactions(30);
    const busy = store.db.pending.filter((p) => p.type === 'record_payment' && ['PENDING', 'DONE', 'EXECUTING'].includes(p.status)).map((p) => p.data.transactionId);
    const result = matchPayments(transactions, store.db.invoices, { alreadyMatched: busy });
    const suggestions = result.suggestions.map((s) => {
      const p = store.addPending({ id: store.id('act'), type: 'record_payment', status: 'PENDING', createdAt: new Date().toISOString(),
        data: { invoiceId: s.invoiceId, number: s.number, clientName: s.clientName, transactionId: s.transaction.id, amount: s.transaction.amount, currency: s.transaction.currency, date: s.transaction.date, payer: s.transaction.payerEmail || s.transaction.payerName, confidence: s.confidence, reasons: s.reasons } });
      return { ...s, pendingId: p.id };
    });
    store.db.lastReconcile = { at: new Date().toISOString(), lastRefreshed, scanned: result.scanned, suggestions, unmatched: result.unmatched };
    store.save();
    store.audit('agent', 'reconciled_transactions', { scanned: result.scanned, suggested: suggestions.length, unmatched: result.unmatched.length });
    return store.db.lastReconcile;
  }
  const asyncTools = { reconcile_payments: async () => {
    const r = await reconcile();
    return { ok: true, scanned: r.scanned, data_refreshed_at: r.lastRefreshed,
      suggestions: r.suggestions.map((s) => ({ pending_approval: s.pendingId, invoice: s.number, client: s.clientName, amount: s.transaction.amount, confidence: s.confidence, reasons: s.reasons })),
      unmatched: r.unmatched.map((u) => ({ amount: u.amount, payer: u.payerEmail || u.payerName, date: u.date })) };
  } };

  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
    store.audit('system', 'error', { route: req.path, message: e.message });
    res.status(e.status && e.status < 500 ? 400 : 502).json({ error: e.message });
  });

  app.get('/api/status', (req, res) => res.json({
    paypal: paypal.mode, ai: provider.name, maxInvoiceAmount: config.maxInvoiceAmount, maxPayoutAmount: config.maxPayoutAmount,
    webhookVerification: !config.paypalDemo && !!config.paypal.webhookId,
  }));
  app.get('/api/state', (req, res) => res.json(view()));

  app.post('/api/chat', wrap(async (req, res) => {
    const msg = String(req.body?.message || '').trim();
    if (!msg) return res.status(400).json({ error: 'Type a request first.' });
    store.audit('user', 'chat', { message: msg.slice(0, 200) });
    const out = await runAgent(provider, msg, { store, config, asyncTools }, chatHistory);
    chatHistory = out.history.filter((h) => h.role !== 'tool' && !h.calls).slice(-8);
    res.json({ reply: out.reply, proposals: out.proposals.map((id) => store.getPending(id)), state: view() });
  }));

  // Paste a client's email -> agent drafts the invoice. The email is untrusted third-party text:
  // it is delimited for the model, and in code only invoice-drafting/read tools are allowed for this turn.
  app.post('/api/intake', wrap(async (req, res) => {
    const text = String(req.body?.email || '').trim();
    if (text.length < 10) return res.status(400).json({ error: 'Paste the client email first.' });
    store.audit('user', 'email_intake', { chars: text.length });
    const out = await runAgent(provider, intakeMessage(text), { store, config, allowedTools: ['create_invoice', 'list_invoices', 'client_insights', 'cash_flow_summary'] }, chatHistory);
    chatHistory = out.history.filter((h) => h.role !== 'tool' && !h.calls).slice(-8);
    res.json({ reply: out.reply, proposals: out.proposals.map((id) => store.getPending(id)), state: view() });
  }));

  // ---- Human-in-the-loop approvals: the ONLY path that touches PayPal for writes ----
  async function execute(p) {
    const d = p.data;
    const key = (step) => `duepilot-${p.id}-${step}`; // stable idempotency keys: retries never double-charge
    if (p.type === 'create_invoice') {
      const draft = await paypal.createDraftInvoice(d, key('create'));
      const inv = store.upsertInvoice({
        id: store.id('inv'), paypalId: draft.paypalId, number: draft.number, dueDate: draft.dueDate,
        clientName: d.clientName, clientEmail: d.clientEmail, amount: d.amount, currency: d.currency, description: d.description, items: d.items,
        status: 'DRAFT', remindersLeft: d.reminders, remindersSent: 0, createdAt: new Date().toISOString(),
      });
      const sent = await paypal.sendInvoice(draft.paypalId, key('send'));
      store.upsertInvoice({ id: inv.id, status: 'SENT', payLink: sent.payLink, sentAt: new Date().toISOString(), nextReminderAt: firstReminder(inv) });
      return { invoiceId: inv.id, number: inv.number, payLink: sent.payLink };
    }
    if (p.type === 'send_reminder') {
      const inv = store.db.invoices.find((i) => i.id === d.invoiceId);
      await paypal.remindInvoice(inv.paypalId, d.message, key('remind'));
      store.upsertInvoice({ id: inv.id, remindersSent: (inv.remindersSent || 0) + 1, lastReminderAt: new Date().toISOString() });
      return { number: inv.number };
    }
    if (p.type === 'cancel_invoice') {
      const inv = store.db.invoices.find((i) => i.id === d.invoiceId);
      await paypal.cancelInvoice(inv.paypalId, key('cancel'));
      store.upsertInvoice({ id: inv.id, status: 'CANCELLED', remindersLeft: 0 });
      return { number: inv.number };
    }
    if (p.type === 'record_payment') {
      const inv = store.db.invoices.find((i) => i.id === d.invoiceId);
      if (!inv) throw new Error('Invoice no longer exists');
      if (inv.status === 'PAID') return { number: inv.number, note: 'already paid' };
      await paypal.recordPayment(inv.paypalId, d, key('record'));
      store.upsertInvoice({ id: inv.id, status: 'PAID', paidAt: new Date(d.date + 'T12:00:00Z').toISOString(), remindersLeft: 0, matchedTransaction: d.transactionId });
      return { number: inv.number, transactionId: d.transactionId };
    }
    if (p.type === 'pay_contractor') {
      const r = await paypal.createPayout(d, key('payout'));
      store.db.payouts = store.db.payouts || [];
      store.db.payouts.unshift({ id: store.id('pay'), ...d, batchId: r.batchId, status: r.status, at: new Date().toISOString() });
      store.save();
      return r;
    }
    throw new Error(`unknown action ${p.type}`);
  }

  app.post('/api/actions/:id/approve', wrap(async (req, res) => {
    const p = store.getPending(req.params.id);
    if (!p) return res.status(404).json({ error: 'Action not found' });
    if (p.status === 'DONE') return res.json({ ok: true, result: p.result, state: view(), duplicate: true });
    if (p.status !== 'PENDING' && p.status !== 'FAILED') return res.status(409).json({ error: `Action is ${p.status}` });
    p.status = 'EXECUTING'; // lock synchronously so double clicks can't run it twice
    store.save();
    try {
      p.result = await execute(p);
      p.status = 'DONE';
      store.audit('user', `approved_${p.type}`, { pendingId: p.id, ...p.result });
      res.json({ ok: true, result: p.result, state: view() });
    } catch (e) {
      p.status = 'FAILED'; p.error = e.message;
      store.audit('system', `failed_${p.type}`, { pendingId: p.id, message: e.message });
      res.status(502).json({ error: e.message, state: view() });
    } finally { store.save(); }
  }));

  app.post('/api/actions/:id/reject', (req, res) => {
    const p = store.getPending(req.params.id);
    if (!p || p.status !== 'PENDING') return res.status(404).json({ error: 'No pending action' });
    p.status = 'REJECTED'; store.save();
    store.audit('user', `rejected_${p.type}`, { pendingId: p.id });
    res.json({ ok: true, state: view() });
  });

  // ---- Webhooks: verified, de-duplicated, auto-reconciled ----
  function applyEvent(event, actor) {
    if (store.seenWebhook(event.id)) return { duplicate: true };
    store.markWebhook(event.id);
    const r = event.resource || {};
    const paypalId = r.invoice?.id || r.id;
    const inv = store.db.invoices.find((i) => i.paypalId === paypalId);
    if (event.event_type === 'INVOICING.INVOICE.PAID' && inv) {
      store.upsertInvoice({ id: inv.id, status: 'PAID', paidAt: new Date().toISOString(), remindersLeft: 0 });
      store.audit(actor, 'reconciled_payment', { number: inv.number, amount: inv.amount, currency: inv.currency });
    } else if (event.event_type === 'INVOICING.INVOICE.CANCELLED' && inv) {
      store.upsertInvoice({ id: inv.id, status: 'CANCELLED', remindersLeft: 0 });
      store.audit(actor, 'invoice_cancelled', { number: inv.number });
    } else {
      store.audit(actor, 'webhook_ignored', { type: event.event_type });
    }
    return { ok: true };
  }

  app.post('/api/webhooks/paypal', wrap(async (req, res) => {
    const event = req.body;
    if (!event?.id || !event?.event_type) return res.status(400).json({ error: 'bad event' });
    const valid = await paypal.verifyWebhook(req.headers, event);
    if (!valid) {
      store.audit('webhook', 'signature_rejected', { type: event.event_type, eventId: event.id });
      return res.status(401).json({ error: 'invalid signature' });
    }
    res.json(applyEvent(event, 'paypal-webhook'));
  }));

  // Fallback reconciliation: pull status from PayPal (useful if a webhook was missed).
  app.post('/api/invoices/:id/sync', wrap(async (req, res) => {
    const inv = store.db.invoices.find((i) => i.id === req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    const r = await paypal.getInvoice(inv.paypalId);
    if (r.status && r.status !== inv.status && ['PAID', 'CANCELLED', 'SENT'].includes(r.status)) {
      store.upsertInvoice({ id: inv.id, status: r.status, ...(r.status === 'PAID' ? { paidAt: new Date().toISOString(), remindersLeft: 0 } : {}) });
      store.audit('sync', 'status_updated', { number: inv.number, status: r.status });
    }
    res.json({ ok: true, state: view() });
  }));

  app.post('/api/reconcile', wrap(async (req, res) => { const r = await reconcile(); res.json({ ...r, state: view() }); }));

  // ---- Scheduled reminders (approved up-front with the invoice) ----
  function firstReminder(inv) {
    if (!inv.remindersLeft) return null;
    return new Date(Math.max(Date.now() + 60_000, new Date(inv.dueDate + 'T09:00:00Z').getTime() - 86400000)).toISOString();
  }
  async function runDueReminders(now = Date.now(), { force = false } = {}) {
    const sent = [];
    const risk = Object.fromEntries(clientInsights(store.db.invoices, now).map((c) => [c.client, c.risk]));
    for (const inv of store.db.invoices) {
      const st = effectiveStatus(inv, now);
      if (!['SENT', 'OVERDUE'].includes(st) || !inv.remindersLeft) continue;
      if (!force && (!inv.nextReminderAt || new Date(inv.nextReminderAt).getTime() > now)) continue;
      const n = (inv.remindersSent || 0) + 1;
      const msg = reminderMessage(inv, n, risk[inv.clientName], st === 'OVERDUE');
      try {
        await paypal.remindInvoice(inv.paypalId, msg, `duepilot-${inv.id}-auto-${n}`);
        store.upsertInvoice({ id: inv.id, remindersLeft: inv.remindersLeft - 1, remindersSent: n, lastReminderAt: new Date(now).toISOString(), nextReminderAt: new Date(now + 3 * 86400000).toISOString() });
        store.audit('scheduler', 'auto_reminder_sent', { number: inv.number, reminder: n });
        sent.push(inv.number);
      } catch (e) { store.audit('scheduler', 'auto_reminder_failed', { number: inv.number, message: e.message }); }
    }
    return sent;
  }
  app.post('/api/reminders/run', wrap(async (req, res) => res.json({ sent: await runDueReminders(Date.now(), { force: !!req.body?.force }), state: view() })));

  // ---- Demo-only helpers (disabled when real sandbox keys are configured) ----
  const demoOnly = (req, res, next) => (config.paypalDemo ? next() : res.status(404).json({ error: 'Demo endpoints are off in sandbox mode' }));
  app.post('/api/demo/pay/:paypalId', demoOnly, (req, res) => {
    const out = applyEvent({ id: `WH-DEMO-${Date.now()}`, event_type: 'INVOICING.INVOICE.PAID', resource: { invoice: { id: req.params.paypalId } } }, 'demo-webhook');
    res.json({ ...out, state: view() });
  });
  app.post('/api/demo/seed', demoOnly, (req, res) => { seedDemo(store); res.json(view()); });
  app.get('/demo-pay/:paypalId', demoOnly, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'demo-pay.html')));
  app.post('/api/reset', (req, res) => { store.reset(); store.db.payouts = []; chatHistory = []; store.audit('user', 'reset', {}); res.json(view()); });

  app.locals = { store, runDueReminders, applyEvent };
  return app;
}

module.exports = { createApp };
