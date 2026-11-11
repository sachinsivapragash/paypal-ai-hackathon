// PayPal client: real sandbox REST calls, or a local simulator in demo mode.
// APIs used: OAuth2 client-credentials, Invoicing v2 (create draft, send, remind, cancel, get),
// Webhooks (verify-webhook-signature). Every mutating call carries a PayPal-Request-Id idempotency key.
const crypto = require('crypto');

// YYYY-MM-DD as PayPal sees it (America/Los_Angeles).
function paypalDate(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

class PayPalError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

// Flattens a Transaction Search record into the fields DuePilot needs for matching.
function normalizeTxn(t) {
  const i = t.transaction_info || {};
  const p = t.payer_info || {};
  return {
    id: i.transaction_id,
    date: (i.transaction_initiation_date || '').slice(0, 10),
    amount: Number(i.transaction_amount?.value || 0),
    currency: i.transaction_amount?.currency_code || 'USD',
    status: i.transaction_status, // S = success, P = pending, D = denied, V = reversed
    eventCode: i.transaction_event_code,
    invoiceId: i.invoice_id || null,
    payerEmail: (p.email_address || '').toLowerCase() || null,
    payerName: [p.payer_name?.given_name, p.payer_name?.surname].filter(Boolean).join(' ') || p.payer_name?.alternate_full_name || null,
    note: i.transaction_note || i.transaction_subject || null,
  };
}

function createPayPal(cfg,{ fetchImpl = globalThis.fetch, demo = false } = {}) {
  let token = null;
  let tokenExp = 0;

  async function getToken() {
    if (token && Date.now() < tokenExp - 60_000) return token;
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    const res = await fetchImpl(`${cfg.apiBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayPalError(`PayPal auth failed: ${body.error_description || res.status}`, res.status, body);
    token = body.access_token;
    tokenExp = Date.now() + body.expires_in * 1000;
    return token;
  }

  async function call(method, path, body, { idempotencyKey, retries = 2 } = {}) {
    const headers = { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    if (idempotencyKey) headers['PayPal-Request-Id'] = idempotencyKey;
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${cfg.apiBase}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (res.ok) return json;
      // Retry only transient errors; idempotency key makes retries safe.
      if ((res.status >= 500 || res.status === 429) && attempt < retries) { await new Promise((r) => setTimeout(r, 300 * (attempt + 1))); continue; }
      const detail = json.details?.[0]?.description || json.message || `HTTP ${res.status}`;
      throw new PayPalError(`PayPal ${method} ${path} failed: ${detail}`, res.status, json);
    }
  }

  function invoicePayload(d) {
    // PayPal reads invoice dates in US Pacific time. Using UTC/IST "today" can be tomorrow there,
    // which makes the invoice "Scheduled" (not payable). So both dates are computed in Pacific time.
    const today = paypalDate(Date.now());
    const due = paypalDate(Date.now() + d.netDays * 86400000);
    return {
      detail: {
        currency_code: d.currency,
        note: d.note || 'Thank you for your business!',
        payment_term: { due_date: due },
        invoice_date: today,
      },
      ...(cfg.invoicerEmail ? { invoicer: { email_address: cfg.invoicerEmail } } : {}),
      primary_recipients: [{ billing_info: { name: { given_name: d.clientName }, email_address: d.clientEmail } }],
      items: (d.items?.length ? d.items : [{ name: d.description, quantity: 1, unitAmount: d.amount }])
        .map((it) => ({ name: it.name.slice(0, 200), quantity: String(it.quantity), unit_amount: { currency_code: d.currency, value: it.unitAmount.toFixed(2) } })),
    };
  }

  const real = {
    mode: 'sandbox',
    async createDraftInvoice(d, key) {
      const inv = await call('POST', '/v2/invoicing/invoices', invoicePayload(d), { idempotencyKey: key });
      return { paypalId: inv.id, number: inv.detail?.invoice_number, dueDate: inv.detail?.payment_term?.due_date, status: inv.status };
    },
    async sendInvoice(paypalId, key) {
      await call('POST', `/v2/invoicing/invoices/${paypalId}/send`, { send_to_invoicer: true, send_to_recipient: true }, { idempotencyKey: key });
      const inv = await call('GET', `/v2/invoicing/invoices/${paypalId}`);
      return { status: inv.status, payLink: inv.detail?.metadata?.recipient_view_url };
    },
    async remindInvoice(paypalId, message, key) {
      await call('POST', `/v2/invoicing/invoices/${paypalId}/remind`, { subject: 'Friendly reminder', note: message, send_to_recipient: true }, { idempotencyKey: key });
      return { ok: true };
    },
    async cancelInvoice(paypalId, key) {
      await call('POST', `/v2/invoicing/invoices/${paypalId}/cancel`, { subject: 'Invoice cancelled', note: 'This invoice was cancelled.', send_to_recipient: true }, { idempotencyKey: key });
      return { status: 'CANCELLED' };
    },
    async getInvoice(paypalId) {
      const inv = await call('GET', `/v2/invoicing/invoices/${paypalId}`);
      return { status: inv.status, payLink: inv.detail?.metadata?.recipient_view_url };
    },
    // Transaction Search (reporting API). Note: PayPal refreshes this data periodically, so very
    // recent payments can take a few hours to appear (see last_refreshed_datetime).
    async searchTransactions(days = 30) {
      const fmt = (d) => d.toISOString().replace(/\.\d+Z$/, '-0000');
      const end = new Date();
      const start = new Date(end.getTime() - Math.min(days, 31) * 86400000);
      const out = [];
      let lastRefreshed = null;
      for (let page = 1; page <= 5; page++) {
        const r = await call('GET', `/v1/reporting/transactions?start_date=${encodeURIComponent(fmt(start))}&end_date=${encodeURIComponent(fmt(end))}&fields=all&page_size=100&page=${page}`);
        lastRefreshed = r.last_refreshed_datetime || lastRefreshed;
        for (const t of r.transaction_details || []) out.push(normalizeTxn(t));
        if (!r.total_pages || page >= r.total_pages) break;
      }
      return { transactions: out, lastRefreshed };
    },
    // Records a payment received outside the invoice flow, which marks the PayPal invoice paid.
    async recordPayment(paypalId, p, key) {
      await call('POST', `/v2/invoicing/invoices/${paypalId}/payments`, {
        method: 'PAYPAL', payment_date: p.date, amount: { currency_code: p.currency, value: Number(p.amount).toFixed(2) },
        note: `Matched by DuePilot to PayPal transaction ${p.transactionId}`,
      }, { idempotencyKey: key });
      return { status: 'PAID' };
    },
    // Payouts API: sender_batch_id doubles as an idempotency key on PayPal's side.
    async createPayout(p, key) {
      const r = await call('POST', '/v1/payments/payouts', {
        sender_batch_header: { sender_batch_id: key, email_subject: 'You have a payment', email_message: p.note },
        items: [{ recipient_type: 'EMAIL', receiver: p.recipientEmail, note: p.note, sender_item_id: key, amount: { value: p.amount.toFixed(2), currency: p.currency } }],
      }, { idempotencyKey: key });
      return { batchId: r.batch_header?.payout_batch_id, status: r.batch_header?.batch_status };
    },
    // Asks PayPal to verify the webhook signature (the officially supported method).
    async verifyWebhook(headers, event) {
      if (!cfg.webhookId) return false;
      const h = (n) => headers[n] || headers[n.toLowerCase()];
      const res = await call('POST', '/v1/notifications/verify-webhook-signature', {
        auth_algo: h('paypal-auth-algo'),
        cert_url: h('paypal-cert-url'),
        transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'),
        transmission_time: h('paypal-transmission-time'),
        webhook_id: cfg.webhookId,
        webhook_event: event,
      });
      return res.verification_status === 'SUCCESS';
    },
  };

  // Simulator: same interface, no network. Honors idempotency keys like PayPal does.
  const sim = { invoices: new Map(), keys: new Map() };
  const once = (key, fn) => { if (key && sim.keys.has(key)) return sim.keys.get(key); const r = fn(); if (key) sim.keys.set(key, r); return r; };
  const fake = {
    mode: 'demo',
    async createDraftInvoice(d, key) {
      return once(key, () => {
        const paypalId = `INV2-DEMO-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const number = String(1000 + sim.invoices.size + 1);
        const dueDate = new Date(Date.now() + d.netDays * 86400000).toISOString().slice(0, 10);
        sim.invoices.set(paypalId, { status: 'DRAFT' });
        return { paypalId, number, dueDate, status: 'DRAFT' };
      });
    },
    async sendInvoice(paypalId, key) {
      return once(key, () => { const i = sim.invoices.get(paypalId) || {}; i.status = 'SENT'; sim.invoices.set(paypalId, i); return { status: 'SENT', payLink: `/demo-pay/${paypalId}` }; });
    },
    async remindInvoice() { return { ok: true }; },
    async cancelInvoice(paypalId) { sim.invoices.set(paypalId, { status: 'CANCELLED' }); return { status: 'CANCELLED' }; },
    async getInvoice(paypalId) { return { status: sim.invoices.get(paypalId)?.status || 'SENT', payLink: `/demo-pay/${paypalId}` }; },
    // Demo: incoming payments that were NOT made through an invoice link, for matching.
    async searchTransactions() {
      const d = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
      return {
        lastRefreshed: new Date().toISOString(),
        transactions: [
          { id: 'DEMO-TXN-7NW1', date: d(1), amount: 280, currency: 'USD', status: 'S', eventCode: 'T0000', invoiceId: null, payerEmail: 'owner@northwind.example.com', payerName: 'Northwind Cafe', note: 'photo edits' },
          { id: 'DEMO-TXN-4OR2', date: d(2), amount: 450, currency: 'USD', status: 'S', eventCode: 'T0000', invoiceId: null, payerEmail: 'payments@orchid-events.example.com', payerName: 'Orchid Events', note: 'posters' },
          { id: 'DEMO-TXN-9ZZ3', date: d(3), amount: 75, currency: 'USD', status: 'S', eventCode: 'T0000', invoiceId: null, payerEmail: 'sam@unknown.example.com', payerName: 'Sam Rivera', note: 'thanks!' },
        ],
      };
    },
    async recordPayment(paypalId) { sim.invoices.set(paypalId, { status: 'PAID' }); return { status: 'PAID' }; },
    async createPayout(p, key) { return once(key, () => ({ batchId: `DEMOBATCH${crypto.randomBytes(4).toString('hex').toUpperCase()}`, status: 'SUCCESS' })); },
    async verifyWebhook() { return false; }, // demo payments go through /api/demo/pay, never the public webhook
  };

  return demo ? fake : real;
}

module.exports = { createPayPal, PayPalError, paypalDate, normalizeTxn };
