// PayPal client: real sandbox REST calls, or a local simulator in demo mode.
// APIs used: OAuth2 client-credentials, Invoicing v2 (create draft, send, remind, cancel, get),
// Webhooks (verify-webhook-signature). Every mutating call carries a PayPal-Request-Id idempotency key.
const crypto = require('crypto');

class PayPalError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

function createPayPal(cfg, { fetchImpl = globalThis.fetch, demo = false } = {}) {
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
    const due = new Date(Date.now() + d.netDays * 86400000).toISOString().slice(0, 10);
    return {
      detail: {
        currency_code: d.currency,
        note: d.note || 'Thank you for your business!',
        payment_term: { due_date: due },
        invoice_date: new Date().toISOString().slice(0, 10),
      },
      ...(cfg.invoicerEmail ? { invoicer: { email_address: cfg.invoicerEmail } } : {}),
      primary_recipients: [{ billing_info: { name: { given_name: d.clientName }, email_address: d.clientEmail } }],
      items: [{ name: d.description.slice(0, 200), quantity: '1', unit_amount: { currency_code: d.currency, value: d.amount.toFixed(2) } }],
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
    async createPayout(p, key) { return once(key, () => ({ batchId: `DEMOBATCH${crypto.randomBytes(4).toString('hex').toUpperCase()}`, status: 'SUCCESS' })); },
    async verifyWebhook() { return false; }, // demo payments go through /api/demo/pay, never the public webhook
  };

  return demo ? fake : real;
}

module.exports = { createPayPal, PayPalError };
