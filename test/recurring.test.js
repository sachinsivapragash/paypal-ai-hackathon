const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

const ASK = 'Invoice Kestrel Labs finance@kestrel.example.com 500 USD every month for website maintenance';

test('recurring: the schedule needs approval; nothing is invoiced before that', async () => {
  const t = await start();
  try {
    const c = await t.post('/api/chat', { message: ASK });
    const p = c.body.proposals[0];
    assert.strictEqual(p.type, 'create_recurring');
    assert.deepStrictEqual([p.data.amount, p.data.every, p.data.clientName], [500, 'month', 'Kestrel Labs']);
    assert.strictEqual(c.body.state.recurring.length, 0);
    const a = await t.post(`/api/actions/${p.id}/approve`);
    assert.strictEqual(a.body.state.recurring.length, 1);
    assert.strictEqual(a.body.state.invoices.length, 0, 'approving the schedule does not create an invoice by itself');
  } finally { await t.close(); }
});

test('recurring: due schedules draft an invoice that waits for approval, then advance one month', async () => {
  const t = await start();
  try {
    const c = await t.post('/api/chat', { message: ASK });
    await t.post(`/api/actions/${c.body.proposals[0].id}/approve`);
    const sched = t.store.db.recurring[0];
    const first = sched.nextRunAt;
    const drafted = await t.app.locals.runRecurring(Date.now());
    assert.strictEqual(drafted.length, 1);
    const p = t.store.getPending(drafted[0]);
    assert.strictEqual(p.type, 'create_invoice');
    assert.strictEqual(p.status, 'PENDING', 'Autopilot is off, so it waits');
    assert.strictEqual(p.source, 'recurring');
    assert.match(p.data.description, /website maintenance \(month of/);
    const next = new Date(first + 'T12:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
    assert.strictEqual(sched.nextRunAt, next.toISOString().slice(0, 10));
    assert.strictEqual((await t.app.locals.runRecurring(Date.now())).length, 0, 'not due again until next month');
  } finally { await t.close(); }
});

test('recurring + Autopilot: a returning client under the limit is invoiced automatically; pause stops drafting', async () => {
  const t = await start();
  try {
    // Kestrel paid once before, and Autopilot allows invoices up to 600.
    const c0 = await t.post('/api/chat', { message: 'Invoice Kestrel Labs finance@kestrel.example.com 100 USD for setup' });
    const a0 = await t.post(`/api/actions/${c0.body.proposals[0].id}/approve`);
    await t.post(`/api/demo/pay/${a0.body.state.invoices[0].paypalId}`);
    await t.post('/api/autopilot', { enabled: true, invoices: { enabled: true, maxAmount: 600 }, dailyLimit: 1000 });

    const c = await t.post('/api/chat', { message: ASK });
    const sp = c.body.proposals[0];
    assert.strictEqual(sp.status, 'PENDING', 'setting up a schedule always needs a human');
    await t.post(`/api/actions/${sp.id}/approve`);
    const id = t.store.db.recurring[0].id;
    const run = await t.post(`/api/recurring/${id}/run`);
    assert.strictEqual(run.body.proposal.status, 'DONE');
    assert.strictEqual(run.body.proposal.autopilot.rule, 'invoices');
    assert.strictEqual(run.body.state.invoices.filter((i) => /month of/.test(i.description)).length, 1);

    await t.post(`/api/recurring/${id}/toggle`);
    const paused = await t.post(`/api/recurring/${id}/run`);
    assert.strictEqual(paused.status, 409);
  } finally { await t.close(); }
});
