const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

test('end-to-end demo flow: chat -> approve -> PayPal invoice sent -> paid via webhook event', async () => {
  const t = await start();
  try {
    const chat = await t.post('/api/chat', { message: 'Invoice Acme Corp ap@acme.example.com 450 USD for the logo work, net 7, remind them twice' });
    assert.strictEqual(chat.status, 200);
    assert.strictEqual(chat.body.proposals.length, 1);
    const p = chat.body.proposals[0];
    assert.deepStrictEqual([p.data.clientName, p.data.amount, p.data.netDays, p.data.reminders], ['Acme Corp', 450, 7, 2]);
    assert.strictEqual(chat.body.state.invoices.length, 0, 'nothing is created before approval');

    const ok = await t.post(`/api/actions/${p.id}/approve`);
    assert.strictEqual(ok.status, 200);
    const inv = ok.body.state.invoices[0];
    assert.strictEqual(inv.status, 'SENT');
    assert.ok(inv.payLink);

    const again = await t.post(`/api/actions/${p.id}/approve`);
    assert.strictEqual(again.body.duplicate, true);
    assert.strictEqual(again.body.state.invoices.length, 1, 'double approve does not create a second invoice');

    const paid = await t.post(`/api/demo/pay/${inv.paypalId}`);
    assert.strictEqual(paid.body.state.invoices[0].status, 'PAID');
    assert.strictEqual(paid.body.state.summary.paid, 450);
    assert.ok(paid.body.state.audit.some((a) => a.action === 'reconciled_payment'));
  } finally { await t.close(); }
});

test('guardrails: over-cap invoice and payout are refused, reject leaves nothing behind', async () => {
  const t = await start();
  try {
    const big = await t.post('/api/chat', { message: 'Invoice Globex billing@globex.example.com 99999 USD for consulting' });
    assert.strictEqual(big.body.proposals.length, 0);
    assert.match(big.body.reply, /safety cap/);

    const payBig = await t.post('/api/chat', { message: 'Pay bob@example.com 900 USD for design' });
    assert.strictEqual(payBig.body.proposals.length, 0);
    assert.match(payBig.body.reply, /cap/);

    const pay = await t.post('/api/chat', { message: 'Pay maria@studio.example.com 120 USD for illustrations' });
    assert.strictEqual(pay.body.proposals.length, 1);
    const rej = await t.post(`/api/actions/${pay.body.proposals[0].id}/reject`);
    assert.strictEqual(rej.body.state.payouts.length, 0);
    const late = await t.post(`/api/actions/${pay.body.proposals[0].id}/approve`);
    assert.strictEqual(late.status, 409, 'rejected actions cannot be approved later');
  } finally { await t.close(); }
});

test('payout, reminder and cancel flows', async () => {
  const t = await start();
  try {
    const pay = await t.post('/api/chat', { message: 'Pay maria@studio.example.com 120 USD for illustrations' });
    const done = await t.post(`/api/actions/${pay.body.proposals[0].id}/approve`);
    assert.strictEqual(done.body.state.payouts[0].amount, 120);

    const c = await t.post('/api/chat', { message: 'Invoice Initech pay@initech.example.com 300 USD for API work, net 14' });
    await t.post(`/api/actions/${c.body.proposals[0].id}/approve`);
    const r = await t.post('/api/chat', { message: 'Remind Initech' });
    assert.strictEqual(r.body.proposals[0].type, 'send_reminder');
    const rs = await t.post(`/api/actions/${r.body.proposals[0].id}/approve`);
    assert.strictEqual(rs.body.state.invoices[0].remindersSent, 1);

    const auto = await t.post('/api/reminders/run', { force: true });
    assert.deepStrictEqual(auto.body.sent.length, 1);

    const x = await t.post('/api/chat', { message: 'Cancel Initech' });
    const xs = await t.post(`/api/actions/${x.body.proposals[0].id}/approve`);
    assert.strictEqual(xs.body.state.invoices[0].status, 'CANCELLED');

    const sum = await t.post('/api/chat', { message: 'cash flow summary' });
    assert.match(sum.body.reply, /Outstanding: 0/);
  } finally { await t.close(); }
});

test('digits inside an email address are never read as the amount', async () => {
  const t = await start();
  try {
    const r = await t.post('/api/chat', { message: 'Invoice Acme Corp sb-ratla53771659@personal.example.com 45 USD for the logo work' });
    assert.strictEqual(r.body.proposals[0].data.amount, 45);
    const p = await t.post('/api/chat', { message: 'Pay sb-abc12345@personal.example.com 20 USD for edits' });
    assert.strictEqual(p.body.proposals[0].data.amount, 20);
  } finally { await t.close(); }
});

test('missing email is rejected by schema validation, not guessed silently by the API', async () => {
  const { validateInvoice } = require('../src/agent/tools');
  const r = validateInvoice({ client_name: 'Acme', client_email: 'nope', amount: 10, description: 'x y' }, 5000);
  assert.ok(r.errors.some((e) => /email/.test(e)));
});
