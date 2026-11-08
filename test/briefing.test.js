const test = require('node:test');
const assert = require('node:assert');
const { briefingFacts, templateBriefing, writeBriefing } = require('../src/briefing');
const { start } = require('./helpers');

const DAY = 86400000;
const now = Date.parse('2026-11-08T12:00:00Z');
const d = (n) => new Date(now + n * DAY).toISOString().slice(0, 10);
const invoices = [
  { id: 'a', number: '1', clientName: 'Northwind', amount: 280, currency: 'USD', status: 'SENT', dueDate: d(-10), sentAt: new Date(now - 17 * DAY).toISOString(), remindersSent: 1 },
  { id: 'b', number: '2', clientName: 'Kestrel', amount: 900, currency: 'USD', status: 'SENT', dueDate: d(3), sentAt: new Date(now - 4 * DAY).toISOString() },
  { id: 'c', number: '3', clientName: 'Brightline', amount: 650, currency: 'USD', status: 'PAID', dueDate: d(-2), sentAt: new Date(now - 12 * DAY).toISOString(), paidAt: new Date(now - 2 * DAY).toISOString() },
];

test('briefing facts are computed in code: due this week, overdue (days late), collected last 7 days, actions', () => {
  const f = briefingFacts(invoices, now);
  assert.strictEqual(f.collectedLast7, 650);
  assert.strictEqual(f.expectedThisWeek, 900);
  assert.deepStrictEqual(f.overdue.map((o) => [o.client, o.daysLate]), [['Northwind', 9]]);
  assert.strictEqual(f.actions[0].label, 'Remind Northwind');
  assert.match(f.actions[0].prompt, /firm but polite/);
  assert.match(templateBriefing(f), /Northwind is 9 day/);
});

test('briefing: Gemini writes the text from supplied facts only; on error it falls back to the template', async () => {
  let prompt;
  const ok = async (url, o) => { prompt = JSON.parse(o.body).contents[0].parts[0].text; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Great week!' }] } }] }) }; };
  const r = await writeBriefing(briefingFacts(invoices, now), { apiKey: 'k', model: 'm', fetchImpl: ok });
  assert.deepStrictEqual([r.text, r.by], ['Great week!', 'gemini:m']);
  assert.match(prompt, /Use ONLY the numbers/);
  assert.match(prompt, /"expectedThisWeek":900/);
  const down = async () => ({ ok: false, json: async () => ({ error: { message: 'quota' } }) });
  const fb = await writeBriefing(briefingFacts(invoices, now), { apiKey: 'k', model: 'm', fallbackModel: 'lite', fetchImpl: down });
  assert.strictEqual(fb.by, 'template');
});

test('briefing endpoint works in demo mode with sample data', async () => {
  const t = await start();
  try {
    await t.post('/api/demo/seed');
    const r = await t.post('/api/briefing');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.briefing.text.length > 20);
    assert.ok(r.body.state.briefing.actions.length >= 1);
  } finally { await t.close(); }
});
