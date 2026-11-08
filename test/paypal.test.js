const test = require('node:test');
const assert = require('node:assert');
const { createPayPal } = require('../src/paypal');
const { gemini } = require('../src/agent/providers');
const { start, testConfig } = require('./helpers');

const cfg = { clientId: 'id', clientSecret: 'secret', apiBase: 'https://api-m.sandbox.paypal.com', invoicerEmail: 'biz@example.com', webhookId: 'WH-1' };
const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

function mockFetch(handler) {
  const calls = [];
  const f = async (url, opts = {}) => { calls.push({ url, opts }); return handler(url, opts, calls); };
  f.calls = calls;
  return f;
}

test('OAuth token is fetched once and cached; invoice calls send idempotency keys', async () => {
  const f = mockFetch((url) => {
    if (url.endsWith('/v1/oauth2/token')) return json(200, { access_token: 'T', expires_in: 3600 });
    if (url.endsWith('/v2/invoicing/invoices')) return json(201, { id: 'INV2-1', status: 'DRAFT', detail: { invoice_number: '0001', payment_term: { due_date: '2026-11-15' } } });
    if (url.endsWith('/send')) return json(200, {});
    return json(200, { status: 'SENT', detail: { metadata: { recipient_view_url: 'https://www.sandbox.paypal.com/invoice/p/#X' } } });
  });
  const pp = createPayPal(cfg, { fetchImpl: f });
  const d = await pp.createDraftInvoice({ clientName: 'Acme', clientEmail: 'a@b.co', amount: 450, currency: 'USD', description: 'Logo', netDays: 7 }, 'key-1');
  const s = await pp.sendInvoice(d.paypalId, 'key-2');
  assert.strictEqual(d.paypalId, 'INV2-1');
  assert.match(s.payLink, /sandbox\.paypal\.com/);
  assert.strictEqual(f.calls.filter((c) => c.url.endsWith('/oauth2/token')).length, 1);
  const create = f.calls.find((c) => c.url.endsWith('/v2/invoicing/invoices'));
  assert.strictEqual(create.opts.headers['PayPal-Request-Id'], 'key-1');
  const body = JSON.parse(create.opts.body);
  assert.strictEqual(body.items[0].unit_amount.value, '450.00');
  assert.strictEqual(body.invoicer.email_address, 'biz@example.com');
});

test('transient 5xx is retried with the same idempotency key; 4xx surfaces a clear error', async () => {
  let n = 0;
  const f = mockFetch((url) => {
    if (url.endsWith('/token')) return json(200, { access_token: 'T', expires_in: 3600 });
    if (url.endsWith('/payouts')) return ++n < 2 ? json(503, {}) : json(201, { batch_header: { payout_batch_id: 'B1', batch_status: 'PENDING' } });
    return json(422, { details: [{ description: 'Invoice cannot be reminded' }] });
  });
  const pp = createPayPal(cfg, { fetchImpl: f });
  const r = await pp.createPayout({ recipientEmail: 'x@y.co', amount: 10, currency: 'USD', note: 'n' }, 'pk');
  assert.strictEqual(r.batchId, 'B1');
  const keys = f.calls.filter((c) => c.url.endsWith('/payouts')).map((c) => c.opts.headers['PayPal-Request-Id']);
  assert.deepStrictEqual(keys, ['pk', 'pk']);
  await assert.rejects(pp.remindInvoice('INV2-1', 'hi', 'rk'), /cannot be reminded/);
});

test('webhook verification posts headers + event to PayPal verify endpoint', async () => {
  const f = mockFetch((url, opts) => {
    if (url.endsWith('/token')) return json(200, { access_token: 'T', expires_in: 3600 });
    const b = JSON.parse(opts.body);
    return json(200, { verification_status: b.transmission_sig === 'good' && b.webhook_id === 'WH-1' ? 'SUCCESS' : 'FAILURE' });
  });
  const pp = createPayPal(cfg, { fetchImpl: f });
  const h = { 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.sandbox.paypal.com/cert', 'paypal-transmission-id': '1', 'paypal-transmission-time': 't' };
  assert.strictEqual(await pp.verifyWebhook({ ...h, 'paypal-transmission-sig': 'good' }, { id: 'E' }), true);
  assert.strictEqual(await pp.verifyWebhook({ ...h, 'paypal-transmission-sig': 'forged' }, { id: 'E' }), false);
});

test('webhook endpoint: rejects bad signatures, reconciles valid ones once', async () => {
  const fakePaypal = { mode: 'sandbox', verifyWebhook: async (h) => h['paypal-transmission-sig'] === 'good' };
  const t = await start(testConfig({ paypalDemo: false }), { paypal: fakePaypal });
  try {
    t.store.upsertInvoice({ id: 'inv_1', paypalId: 'INV2-X', number: '7', clientName: 'Acme', amount: 50, currency: 'USD', status: 'SENT', dueDate: '2099-01-01' });
    const event = { id: 'WH-EVT-1', event_type: 'INVOICING.INVOICE.PAID', resource: { invoice: { id: 'INV2-X' } } };
    const bad = await t.post('/api/webhooks/paypal', event, { 'paypal-transmission-sig': 'forged' });
    assert.strictEqual(bad.status, 401);
    assert.strictEqual(t.store.db.invoices[0].status, 'SENT');
    const good = await t.post('/api/webhooks/paypal', event, { 'paypal-transmission-sig': 'good' });
    assert.strictEqual(good.status, 200);
    assert.strictEqual(t.store.db.invoices[0].status, 'PAID');
    const dup = await t.post('/api/webhooks/paypal', event, { 'paypal-transmission-sig': 'good' });
    assert.strictEqual(dup.body.duplicate, true);
    const demoOff = await t.post('/api/demo/pay/INV2-X');
    assert.strictEqual(demoOff.status, 404, 'demo payment shortcut is disabled in sandbox mode');
  } finally { await t.close(); }
});

test('Gemini: rate limit on main model retries on the lite model; raw parts (thought signatures) are replayed', async () => {
  const f = mockFetch((url) => url.includes('gemini-main') ? json(429, { error: { message: 'quota' } })
    : json(200, { candidates: [{ content: { parts: [{ functionCall: { name: 'list_invoices', args: {} }, thoughtSignature: 'sig' }] } }] }));
  const p = gemini({ apiKey: 'k', model: 'gemini-main', fallbackModel: 'gemini-lite', system: 's', fetchImpl: f });
  const out = await p.step([{ role: 'user', text: 'list' }], []);
  assert.strictEqual(out.calls[0].name, 'list_invoices');
  assert.ok(f.calls[1].url.includes('gemini-lite'));
  await p.step([{ role: 'user', text: 'list' }, { role: 'model', calls: out.calls, raw: out.raw }, { role: 'tool', name: 'list_invoices', result: { ok: true } }], []);
  const replay = JSON.parse(f.calls.at(-1).opts.body).contents[1].parts[0];
  assert.strictEqual(replay.thoughtSignature, 'sig');
});

test('Gemini provider maps functionCall parts to tool calls and sends tools', async () => {
  const f = mockFetch(() => json(200, { candidates: [{ content: { parts: [{ functionCall: { name: 'create_invoice', args: { client_name: 'Acme' } } }] } }] }));
  const p = gemini({ apiKey: 'k', model: 'gemini-3.5-flash', system: 's', fetchImpl: f });
  const out = await p.step([{ role: 'user', text: 'bill acme' }], [{ name: 'create_invoice' }]);
  assert.deepStrictEqual(out.calls, [{ name: 'create_invoice', args: { client_name: 'Acme' } }]);
  const sent = JSON.parse(f.calls[0].opts.body);
  assert.strictEqual(sent.tools[0].functionDeclarations[0].name, 'create_invoice');
  assert.strictEqual(f.calls[0].opts.headers['x-goog-api-key'], 'k');
});
