// Weekly cash-flow briefing. Numbers are computed here deterministically; the AI only writes the
// words around them, and every number it may use is handed to it, so it can't invent figures.
const { summary, clientInsights, effectiveStatus } = require('./agent/tools');

const DAY = 86400000;
const round = (n) => Math.round(n * 100) / 100;

function briefingFacts(invoices, now = Date.now()) {
  const s = summary(invoices, now);
  const weekEnd = now + 7 * DAY;
  const open = invoices.filter((i) => ['SENT', 'OVERDUE'].includes(effectiveStatus(i, now)));
  const dueThisWeek = open.filter((i) => effectiveStatus(i, now) === 'SENT' && Date.parse(i.dueDate + 'T23:59:59Z') <= weekEnd)
    .map((i) => ({ number: i.number, client: i.clientName, amount: i.amount, due: i.dueDate }));
  const overdue = open.filter((i) => effectiveStatus(i, now) === 'OVERDUE')
    .map((i) => ({ number: i.number, client: i.clientName, amount: i.amount, daysLate: Math.max(1, Math.floor((now - Date.parse(i.dueDate + 'T23:59:59Z')) / DAY)), remindersSent: i.remindersSent || 0 }))
    .sort((a, b) => b.daysLate - a.daysLate);
  const paidLast7 = invoices.filter((i) => i.status === 'PAID' && i.paidAt && now - Date.parse(i.paidAt) <= 7 * DAY);
  const risky = clientInsights(invoices, now).filter((c) => c.risk === 'high' && c.owed > 0).map((c) => ({ client: c.client, owed: c.owed, avgDaysToPay: c.avgDaysToPay, lateRate: c.lateRate }));
  const actions = [];
  for (const o of overdue.slice(0, 3)) actions.push({ label: `Remind ${o.client}`, prompt: `Remind ${o.client} about invoice #${o.number}${o.daysLate > 7 ? ' (firm but polite, it is ' + o.daysLate + ' days late)' : ''}` });
  if (open.length) actions.push({ label: 'Check for direct payments', prompt: 'Did anyone pay me outside an invoice?' });
  return {
    generatedAt: new Date(now).toISOString(),
    collectedLast7: round(paidLast7.reduce((a, i) => a + i.amount, 0)),
    expectedThisWeek: round(dueThisWeek.reduce((a, i) => a + i.amount, 0)),
    outstanding: s.outstanding, overdueTotal: s.overdue,
    dueThisWeek, overdue, risky, actions,
  };
}

// Plain-language fallback used when no AI is available (demo mode, or Gemini down).
function templateBriefing(f) {
  const lines = [];
  lines.push(`You collected $${f.collectedLast7} in the last 7 days and $${f.outstanding} is still outstanding.`);
  if (f.dueThisWeek.length) lines.push(`$${f.expectedThisWeek} is due this week from ${f.dueThisWeek.map((d) => d.client).join(', ')}.`);
  if (f.overdue.length) lines.push(`${f.overdue[0].client} is ${f.overdue[0].daysLate} day(s) late on #${f.overdue[0].number} ($${f.overdue[0].amount}); a reminder is a good next step.`);
  else lines.push('Nothing is overdue. Nice.');
  if (f.risky.length) lines.push(`Watch ${f.risky[0].client}: they pay late ${f.risky[0].lateRate}% of the time.`);
  return lines.join(' ');
}

// Asks Gemini for a short, friendly write-up of the facts. Falls back to the template on any error.
async function writeBriefing(facts, { apiKey, model, fallbackModel, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) return { text: templateBriefing(facts), by: 'template' };
  const prompt = `You are DuePilot, a collections assistant for a freelancer. Write this week's cash-flow briefing in at most 4 short sentences, warm and practical. Use ONLY the numbers in the JSON below (do not compute new totals or invent figures). End with the single most useful next action.\n\n${JSON.stringify({ ...facts, actions: undefined })}`;
  for (const m of [model, fallbackModel].filter(Boolean)) {
    try {
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(25_000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4 } }),
      });
      const body = await res.json().catch(() => ({}));
      const text = (body.candidates?.[0]?.content?.parts || []).filter((p) => p.text).map((p) => p.text).join('').trim();
      if (res.ok && text) return { text, by: `gemini:${m}` };
    } catch { /* try next model, then the template */ }
  }
  return { text: templateBriefing(facts), by: 'template' };
}

module.exports = { briefingFacts, templateBriefing, writeBriefing };
