const test = require('node:test');
const assert = require('node:assert');
const { decide, normalizePolicy, autoSpentToday } = require('../src/autopilot');
const { start } = require('./helpers');

const ON = { enabled: true, invoices: { enabled: true, maxAmount: 200, knownClientsOnly: true }, reminders: { enabled: true }, matching: { enabled: true }, dailyLimit: 300 };
const paidBefore = [{ clientEmail: 'ap@acme.example.com', status: 'PAID' }];
const inv = (amount, email = 'ap@acme.example.com', source = 'chat') => ({ type: 'create_invoice', source, data: { amount, clientEmail: email } });

test('autopilot is off by default and policy input is clamped to hard limits', () => {
  assert.strictEqual(decide(inv(10), { policy: undefined, invoices: paidBefore, audit: [] }).auto, false);
  const p = normalizePolicy({ enabled: true, invoices: { maxAmount: 999999 }, dailyLimit: -5, junk: 1 });
  assert.strictEqual(p.invoices.maxAmount, 1000);
  assert.strictEqual(p.dailyLimit, 0);
  assert.strictEqual(p.junk, undefined);
});

test('payouts, cancellations and anything from a pasted email can never be automated', () => {
  const ctx = { policy: ON, invoices: paidBefore, audit: [] };
  assert.strictEqual(decide({ type: 'pay_contractor', data: { amount: 1 } }, ctx).auto, false);
  assert.strictEqual(decide({ type: 'cancel_invoice', data: {} }, ctx).auto, false);
  const r = decide(inv(10, 'ap@acme.example.com', 'email'), ctx);
  assert.strictEqual(r.auto, false);
  assert.match(r.reason, /pasted email/);
});

test('invoice rules: amount limit, known-clients-only, daily cap', () => {
  const ctx = (audit = []) => ({ policy: ON, invoices: paidBefore, audit });
  assert.strictEqual(decide(inv(150), ctx()).auto, true);
  assert.match(decide(inv(250), ctx()).reason, /over the autopilot limit/);
  assert.match(decide(inv(50, 'new@client.example.com'), ctx()).reason, /new client/);
  const today = new Date().toISOString();
  const audit = [{ actor: 'autopilot', action: 'approved_create_invoice', at: today, details: { amount: 200 } }];
  assert.strictEqual(autoSpentToday(audit), 200);
  assert.match(decide(inv(150), ctx(audit)).reason, /cap/);
  assert.strictEqual(decide(inv(100), ctx(audit)).auto, true);
});

test('matching rule only auto-approves high-confidence matches', () => {
  const ctx = { policy: ON, invoices: [], audit: [] };
  assert.strictEqual(decide({ type: 'record_payment', data: { confidence: 'high', reasons: ['exact amount'] } }, ctx).auto, true);
  assert.strictEqual(decide({ type: 'record_payment', data: { confidence: 'medium' } }, ctx).auto, false);
});

test('end to end: with autopilot on, a returning client is invoiced without a click and logged with its rule; a new client still waits', async () => {
  const t = await start();
  try {
    // First invoice + payment makes Acme a returning client.
    const c1 = await t.post('/api/chat', { message: 'Invoice Acme Corp ap@acme.example.com 100 USD for logo work' });
    const a1 = await t.post(`/api/actions/${c1.body.proposals[0].id}/approve`);
    await t.post(`/api/demo/pay/${a1.body.state.invoices[0].paypalId}`);
    const pol = await t.post('/api/autopilot', { enabled: true, invoices: { enabled: true, maxAmount: 200 } });
    assert.strictEqual(pol.body.policy.enabled, true);

    const c2 = await t.post('/api/chat', { message: 'Invoice Acme Corp ap@acme.example.com 120 USD for banner work' });
    const p2 = c2.body.proposals[0];
    assert.strictEqual(p2.status, 'DONE', 'executed by autopilot');
    assert.strictEqual(p2.autopilot.rule, 'invoices');
    assert.ok(c2.body.state.audit.some((a) => a.actor === 'autopilot' && a.action === 'approved_create_invoice' && a.details.rule === 'invoices'));
    assert.strictEqual(c2.body.state.autopilot.spentToday, 120);

    const c3 = await t.post('/api/chat', { message: 'Invoice Globex billing@globex.example.com 50 USD for icons' });
    assert.strictEqual(c3.body.proposals[0].status, 'PENDING');
    assert.match(c3.body.proposals[0].autopilot.reason, /new client/);

    const pay = await t.post('/api/chat', { message: 'Pay maria@studio.example.com 20 USD for illustrations' });
    assert.strictEqual(pay.body.proposals[0].status, 'PENDING', 'payouts are never automatic');

    const intake = await t.post('/api/intake', { email: 'From: Acme <ap@acme.example.com>\n\nPlease bill 1 logo tweak at $40. Thanks' });
    assert.strictEqual(intake.body.proposals[0].status, 'PENDING', 'pasted-email work never runs on autopilot');
  } finally { await t.close(); }
});
