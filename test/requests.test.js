const test = require('node:test');
const assert = require('node:assert');
const { createPayPal } = require('../src/paypal');
const { start, testConfig } = require('./helpers');

test('Orders v2 client: create sends intent CAPTURE + return URLs + idempotency key; capture tolerates ORDER_ALREADY_CAPTURED', async () => {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'T', expires_in: 3600 }) };
    if (url.endsWith('/v2/checkout/orders')) return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'O1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=O1' }] }) };
    return { ok: false, status: 422, text: async () => JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }) };
  };
  const pp = createPayPal({ clientId: 'a', clientSecret: 'b', apiBase: 'https://api-m.sandbox.paypal.com' }, { fetchImpl: f });
  const o = await pp.createOrder({ requestId: 'req_1', amount: 40, currency: 'USD', note: 'logo tweak', returnUrl: 'https://x/api/pay/return', cancelUrl: 'https://x/' }, 'k1');
  assert.deepStrictEqual(o, { orderId: 'O1', status: 'PAYER_ACTION_REQUIRED', approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=O1' });
  const body = JSON.parse(calls[1].opts.body);
  assert.strictEqual(body.intent, 'CAPTURE');
  assert.strictEqual(body.purchase_units[0].amount.value, '40.00');
  assert.strictEqual(body.payment_source.paypal.experience_context.return_url, 'https://x/api/pay/return');
  assert.strictEqual(calls[1].opts.headers['PayPal-Request-Id'], 'k1');
  assert.deepStrictEqual(await pp.captureOrder('O1', 'k2'), { status: 'COMPLETED', alreadyCaptured: true });
});

test('payment request: approval → checkout link → client returns → captured once', async () => {
  const t = await start();
  try {
    const c = await t.post('/api/chat', { message: 'Request $40 from Sam Rivera for the logo tweak' });
    const p = c.body.proposals[0];
    assert.strictEqual(p.type, 'create_payment_request');
    assert.deepStrictEqual([p.data.payerName, p.data.amount], ['Sam Rivera', 40]);
    assert.strictEqual((c.body.state.requests || []).length, 0, 'no link before approval');
    const a = await t.post(`/api/actions/${p.id}/approve`);
    const req = a.body.state.requests[0];
    assert.strictEqual(req.status, 'AWAITING_PAYMENT');
    assert.match(a.body.result.payLink, /DEMO-ORDER-/);
    // PayPal redirects the client back with ?token=<orderId>
    const back = await fetch(`http://127.0.0.1:${t.server.address().port}/api/pay/return?token=${req.orderId}`, { redirect: 'manual' });
    assert.strictEqual(back.status, 302);
    assert.strictEqual(back.headers.get('location'), '/?request=paid');
    const st = await t.get('/api/state');
    assert.strictEqual(st.body.requests[0].status, 'PAID');
    const again = await fetch(`http://127.0.0.1:${t.server.address().port}/api/pay/return?token=${req.orderId}`, { redirect: 'manual' });
    assert.strictEqual(again.headers.get('location'), '/?request=paid');
    assert.strictEqual(t.store.db.audit.filter((x) => x.action === 'payment_request_captured').length, 1, 'captured exactly once');
  } finally { await t.close(); }
});

test('payment request: verified CHECKOUT.ORDER.APPROVED webhook captures it even if the client never returns', async () => {
  let captured = 0;
  const fakePaypal = { mode: 'sandbox', verifyWebhook: async () => true, createOrder: async () => ({ orderId: 'O9', approveUrl: 'https://pp/checkout' }), captureOrder: async () => { captured++; return { status: 'COMPLETED', captureId: 'CAP9' }; } };
  const t = await start(testConfig({ paypalDemo: false }), { paypal: fakePaypal });
  try {
    const c = await t.post('/api/chat', { message: 'Request $25 from Ana for a sticker pack' });
    await t.post(`/api/actions/${c.body.proposals[0].id}/approve`);
    await t.post('/api/webhooks/paypal', { id: 'WH-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'O9' } });
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(t.store.db.requests[0].status, 'PAID');
    assert.strictEqual(t.store.db.requests[0].captureId, 'CAP9');
    await t.post('/api/webhooks/paypal', { id: 'WH-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'O9' } });
    assert.strictEqual(captured, 1, 'duplicate webhook does not capture twice');
  } finally { await t.close(); }
});

test('payment request: amount cap applies', async () => {
  const t = await start();
  try {
    const c = await t.post('/api/chat', { message: 'Request $99999 from Sam for everything' });
    assert.strictEqual(c.body.proposals.length, 0);
    assert.match(c.body.reply, /cap/);
  } finally { await t.close(); }
});
