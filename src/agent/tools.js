// Agent tools. Read-only tools run immediately. Any tool that creates, sends or cancels
// a PayPal object only creates a PENDING ACTION that a human must approve in the UI.

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'SGD'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const declarations = [
  {
    name: 'create_invoice',
    description: 'Draft a PayPal invoice for a client. It is NOT sent until the user approves it.',
    parameters: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'Client or company name' },
        client_email: { type: 'string', description: 'Client email address' },
        amount: { type: 'number', description: 'Total amount, e.g. 450' },
        currency: { type: 'string', description: 'ISO currency code, default USD' },
        description: { type: 'string', description: 'What the work was' },
        net_days: { type: 'integer', description: 'Payment terms in days, default 7' },
        reminders: { type: 'integer', description: 'How many automatic reminders (0-3), default 1' },
      },
      required: ['client_name', 'client_email', 'amount', 'description'],
    },
  },
  {
    name: 'send_reminder',
    description: 'Prepare a polite payment reminder for an unpaid invoice. Write the reminder text yourself in "message". Needs user approval.',
    parameters: {
      type: 'object',
      properties: {
        invoice: { type: 'string', description: 'Invoice id, number, or client name' },
        message: { type: 'string', description: 'Short, warm, professional reminder text (max 400 chars)' },
      },
      required: ['invoice', 'message'],
    },
  },
  {
    name: 'cancel_invoice',
    description: 'Cancel an unpaid invoice. Needs user approval.',
    parameters: { type: 'object', properties: { invoice: { type: 'string' } }, required: ['invoice'] },
  },
  {
    name: 'pay_contractor',
    description: 'Pay a contractor or supplier via PayPal Payouts. Money only moves after the user approves, and only under the payout cap.',
    parameters: {
      type: 'object',
      properties: {
        recipient_email: { type: 'string', description: 'PayPal email of the person being paid' },
        amount: { type: 'number' },
        currency: { type: 'string', description: 'default USD' },
        note: { type: 'string', description: 'What the payment is for' },
      },
      required: ['recipient_email', 'amount', 'note'],
    },
  },
  {
    name: 'list_invoices',
    description: 'List invoices, optionally filtered by status (DRAFT, SENT, PAID, CANCELLED, OVERDUE).',
    parameters: { type: 'object', properties: { status: { type: 'string' } } },
  },
  {
    name: 'client_insights',
    description: 'Per-client payment behaviour: average days to pay, late-payment rate, amount owed and a risk level (low/medium/high). Use it to decide who to chase first and how firmly.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'cash_flow_summary',
    description: 'Totals of paid, outstanding and overdue money, plus who owes the most.',
    parameters: { type: 'object', properties: {} },
  },
];

// Schema validation for model output: never trust LLM arguments blindly.
function validateInvoice(a, maxAmount) {
  const errors = [];
  const amount = Number(a.amount);
  const currency = String(a.currency || 'USD').toUpperCase();
  const netDays = a.net_days == null ? 7 : Number(a.net_days);
  const reminders = a.reminders == null ? 1 : Number(a.reminders);
  if (!a.client_name || String(a.client_name).trim().length < 2) errors.push('client name is missing');
  if (!EMAIL.test(String(a.client_email || ''))) errors.push('a valid client email is required');
  if (!Number.isFinite(amount) || amount <= 0) errors.push('amount must be a positive number');
  if (amount > maxAmount) errors.push(`amount exceeds the safety cap of ${maxAmount}`);
  if (!CURRENCIES.includes(currency)) errors.push(`unsupported currency ${currency}`);
  if (!Number.isInteger(netDays) || netDays < 0 || netDays > 90) errors.push('net days must be 0-90');
  if (!Number.isInteger(reminders) || reminders < 0 || reminders > 3) errors.push('reminders must be 0-3');
  if (!a.description || String(a.description).trim().length < 2) errors.push('description is missing');
  return {
    errors,
    value: {
      clientName: String(a.client_name || '').trim(),
      clientEmail: String(a.client_email || '').trim().toLowerCase(),
      amount: Math.round(amount * 100) / 100,
      currency,
      description: String(a.description || '').trim(),
      netDays,
      reminders,
    },
  };
}

function effectiveStatus(inv, now = Date.now()) {
  if (inv.status === 'SENT' && inv.dueDate && new Date(inv.dueDate + 'T23:59:59Z').getTime() < now) return 'OVERDUE';
  return inv.status;
}

function summary(invoices, now = Date.now()) {
  const s = { paid: 0, outstanding: 0, overdue: 0, count: invoices.length, currency: 'USD', topDebtor: null };
  const owed = {};
  for (const inv of invoices) {
    const st = effectiveStatus(inv, now);
    if (st === 'PAID') s.paid += inv.amount;
    if (st === 'SENT' || st === 'OVERDUE') { s.outstanding += inv.amount; owed[inv.clientName] = (owed[inv.clientName] || 0) + inv.amount; }
    if (st === 'OVERDUE') s.overdue += inv.amount;
  }
  const top = Object.entries(owed).sort((a, b) => b[1] - a[1])[0];
  if (top) s.topDebtor = { name: top[0], amount: top[1] };
  for (const k of ['paid', 'outstanding', 'overdue']) s[k] = Math.round(s[k] * 100) / 100;
  return s;
}

// Per-client payment behaviour: how fast they pay, how often they're late -> risk level.
function clientInsights(invoices, now = Date.now()) {
  const by = {};
  for (const inv of invoices) {
    if (inv.status === 'DRAFT' || inv.status === 'CANCELLED') continue;
    const c = (by[inv.clientName] ||= { client: inv.clientName, invoices: 0, paid: 0, late: 0, open: 0, overdue: 0, owed: 0, daysToPay: [] });
    c.invoices++;
    const st = effectiveStatus(inv, now);
    if (st === 'PAID' && inv.paidAt && inv.sentAt) {
      c.paid++;
      c.daysToPay.push((new Date(inv.paidAt) - new Date(inv.sentAt)) / 86400000);
      if (inv.dueDate && new Date(inv.paidAt) > new Date(inv.dueDate + 'T23:59:59Z')) c.late++;
    }
    if (st === 'SENT' || st === 'OVERDUE') { c.open++; c.owed += inv.amount; }
    if (st === 'OVERDUE') c.overdue++;
  }
  return Object.values(by).map((c) => {
    const avg = c.daysToPay.length ? c.daysToPay.reduce((a, b) => a + b, 0) / c.daysToPay.length : null;
    const lateRate = c.paid ? c.late / c.paid : 0;
    const score = (c.overdue ? 2 : 0) + (lateRate >= 0.5 ? 2 : lateRate > 0 ? 1 : 0) + (avg != null && avg > 14 ? 1 : 0);
    const risk = score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low';
    return { client: c.client, invoices: c.invoices, open: c.open, owed: Math.round(c.owed * 100) / 100, avgDaysToPay: avg == null ? null : Math.round(avg * 10) / 10, lateRate: Math.round(lateRate * 100), risk };
  }).sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.risk] - { high: 0, medium: 1, low: 2 }[b.risk]) || b.owed - a.owed);
}

// Reminder copy escalates gently with each reminder and with the client's risk level.
function reminderMessage(inv, n, risk, overdue) {
  const amt = `${inv.amount} ${inv.currency}`;
  if (!overdue) return `Hi ${inv.clientName}, a friendly heads-up that invoice #${inv.number} for ${amt} is due on ${inv.dueDate}. You can pay in a couple of clicks with the PayPal link. Thank you!`;
  if (n <= 1 && risk !== 'high') return `Hi ${inv.clientName}, just a gentle nudge: invoice #${inv.number} (${amt}) was due on ${inv.dueDate}. If it's already on its way, thank you and please ignore this!`;
  return `Hi ${inv.clientName}, invoice #${inv.number} for ${amt} is now overdue (due ${inv.dueDate}). Could you let me know when I can expect payment, or if anything is blocking it? Happy to help.`;
}

// Honest, clearly-labelled estimate of manual admin time the agent replaced.
const MINUTES = { invoice: 12, reminder: 5, reconcile: 6, payout: 6 };
function timeSaved(audit) {
  let m = 0;
  for (const a of audit) {
    if (a.action === 'approved_create_invoice') m += MINUTES.invoice;
    else if (a.action === 'approved_send_reminder' || a.action === 'auto_reminder_sent') m += MINUTES.reminder;
    else if (a.action === 'reconciled_payment') m += MINUTES.reconcile;
    else if (a.action === 'approved_pay_contractor') m += MINUTES.payout;
  }
  return m;
}

function publicInvoice(inv) {
  return { id: inv.id, number: inv.number, client: inv.clientName, amount: inv.amount, currency: inv.currency, status: effectiveStatus(inv), due: inv.dueDate };
}

// Executes a tool call from the model. Returns a JSON-able result for the model.
function runTool(name, args, { store, config }) {
  switch (name) {
    case 'create_invoice': {
      const { errors, value } = validateInvoice(args || {}, config.maxInvoiceAmount);
      if (errors.length) return { ok: false, errors };
      const p = store.addPending({ id: store.id('act'), type: 'create_invoice', status: 'PENDING', createdAt: new Date().toISOString(), data: value });
      store.audit('agent', 'proposed_invoice', { pendingId: p.id, ...value });
      return { ok: true, pending_approval: p.id, preview: value, note: 'Shown to the user for approval. Not sent yet.' };
    }
    case 'send_reminder':
    case 'cancel_invoice': {
      const inv = store.findInvoice(args?.invoice);
      if (!inv) return { ok: false, errors: [`no invoice matches "${args?.invoice}"`] };
      const st = effectiveStatus(inv);
      if (!['SENT', 'OVERDUE'].includes(st)) return { ok: false, errors: [`invoice ${inv.number} is ${st}; only unpaid sent invoices can be ${name === 'cancel_invoice' ? 'cancelled' : 'reminded'}`] };
      const data = { invoiceId: inv.id, number: inv.number, clientName: inv.clientName, amount: inv.amount, currency: inv.currency };
      if (name === 'send_reminder') data.message = String(args.message || '').slice(0, 400) || `Hi ${inv.clientName}, a friendly reminder that invoice #${inv.number} is awaiting payment. Thank you!`;
      const p = store.addPending({ id: store.id('act'), type: name, status: 'PENDING', createdAt: new Date().toISOString(), data });
      store.audit('agent', `proposed_${name}`, { pendingId: p.id, number: inv.number });
      return { ok: true, pending_approval: p.id, preview: data };
    }
    case 'pay_contractor': {
      const amount = Math.round(Number(args?.amount) * 100) / 100;
      const currency = String(args?.currency || 'USD').toUpperCase();
      const email = String(args?.recipient_email || '').trim().toLowerCase();
      const errors = [];
      if (!EMAIL.test(email)) errors.push('a valid recipient PayPal email is required');
      if (!Number.isFinite(amount) || amount <= 0) errors.push('amount must be a positive number');
      if (amount > config.maxPayoutAmount) errors.push(`payout exceeds the safety cap of ${config.maxPayoutAmount}`);
      if (!CURRENCIES.includes(currency)) errors.push(`unsupported currency ${currency}`);
      if (errors.length) return { ok: false, errors };
      const data = { recipientEmail: email, amount, currency, note: String(args.note || 'Payment').slice(0, 200) };
      const p = store.addPending({ id: store.id('act'), type: 'pay_contractor', status: 'PENDING', createdAt: new Date().toISOString(), data });
      store.audit('agent', 'proposed_payout', { pendingId: p.id, ...data });
      return { ok: true, pending_approval: p.id, preview: data, note: 'No money has moved. Waiting for approval.' };
    }
    case 'list_invoices': {
      let list = store.db.invoices.map(publicInvoice);
      if (args?.status) list = list.filter((i) => i.status === String(args.status).toUpperCase());
      return { ok: true, invoices: list.slice(0, 20) };
    }
    case 'cash_flow_summary':
      return { ok: true, ...summary(store.db.invoices) };
    case 'client_insights':
      return { ok: true, clients: clientInsights(store.db.invoices).slice(0, 10) };
    default:
      return { ok: false, errors: [`unknown tool ${name}`] };
  }
}

module.exports = { declarations, runTool, validateInvoice, summary, effectiveStatus, publicInvoice, clientInsights, reminderMessage, timeSaved };
