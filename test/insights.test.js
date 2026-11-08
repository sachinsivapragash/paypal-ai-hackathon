const test = require('node:test');
const assert = require('node:assert');
const { clientInsights, reminderMessage, timeSaved } = require('../src/agent/tools');
const { start } = require('./helpers');

const DAY = 86400000;
const now = Date.parse('2026-11-08T12:00:00Z');
const inv = (o) => ({ currency: 'USD', status: 'PAID', ...o });

test('client insights: late and overdue clients rank as high risk, prompt payers as low', () => {
  const list = clientInsights([
    inv({ clientName: 'Fast', amount: 100, sentAt: new Date(now - 20 * DAY).toISOString(), paidAt: new Date(now - 17 * DAY).toISOString(), dueDate: '2026-10-26' }),
    inv({ clientName: 'Slow', amount: 100, sentAt: new Date(now - 40 * DAY).toISOString(), paidAt: new Date(now - 15 * DAY).toISOString(), dueDate: '2026-10-06' }),
    inv({ clientName: 'Slow', amount: 300, status: 'SENT', sentAt: new Date(now - 20 * DAY).toISOString(), dueDate: '2026-10-25' }),
  ], now);
  assert.strictEqual(list[0].client, 'Slow');
  assert.strictEqual(list[0].risk, 'high');
  assert.strictEqual(list[0].owed, 300);
  assert.strictEqual(list[0].avgDaysToPay, 25);
  assert.strictEqual(list.find((c) => c.client === 'Fast').risk, 'low');
});

test('reminder tone escalates with reminder count and risk', () => {
  const i = { clientName: 'Acme', number: '7', amount: 50, currency: 'USD', dueDate: '2026-11-01' };
  assert.match(reminderMessage(i, 1, 'low', false), /friendly heads-up/);
  assert.match(reminderMessage(i, 1, 'low', true), /gentle nudge/);
  assert.match(reminderMessage(i, 2, 'low', true), /overdue/);
  assert.match(reminderMessage(i, 1, 'high', true), /overdue/);
});

test('time saved counts only completed automated work', () => {
  assert.strictEqual(timeSaved([{ action: 'approved_create_invoice' }, { action: 'auto_reminder_sent' }, { action: 'reconciled_payment' }, { action: 'proposed_invoice' }]), 23);
});

test('demo seed + "who should I chase first?" answers from real data', async () => {
  const t = await start();
  try {
    const seeded = await t.post('/api/demo/seed');
    assert.strictEqual(seeded.body.invoices.length, 7);
    assert.ok(seeded.body.insights.length >= 4);
    const r = await t.post('/api/chat', { message: 'Who should I chase first?' });
    assert.match(r.body.reply, /^Chase /);
    const auto = await t.post('/api/reminders/run');
    assert.ok(auto.body.sent.length >= 1, 'due reminders go out for unpaid seeded invoices');
    assert.ok(auto.body.state.summary.minutesSaved > 0);
  } finally { await t.close(); }
});
