const { declarations, runTool } = require('./tools');
const providers = require('./providers');

const SYSTEM = `You are DuePilot, a collections assistant for freelancers and small businesses.
You manage PayPal invoices through tools. Rules:
- Use create_invoice for any request to bill/invoice someone. If the email is missing, ask for it instead of guessing.
- Tools that create, send, remind or cancel only PROPOSE an action; the human approves it on a card. Never claim money was requested or sent until approved.
- Write reminders that are warm, short, and professional. Never threaten.
- Be concise (max 3 sentences). Today is ${new Date().toISOString().slice(0, 10)}.`;

function createProvider(config, opts = {}) {
  if (config.aiDemo) return providers.demo();
  const primary = providers.gemini({ apiKey: config.ai.geminiKey, model: config.ai.geminiModel, fallbackModel: config.ai.geminiFallbackModel, system: SYSTEM, ...opts });
  const fallback = providers.demo();
  // If Gemini is down/rate-limited, answer this turn with the keyless parser and say so openly.
  return {
    name: primary.name,
    async step(history, declarations) {
      try { return await primary.step(history, declarations); } catch (e) {
        const out = await fallback.step(history, declarations);
        out.fallback = e.message;
        return out;
      }
    },
  };
}

// Runs one user turn: model -> tool calls -> model, up to a few rounds.
async function runAgent(provider, userText, ctx, priorHistory = []) {
  const history = [...priorHistory.slice(-8), { role: 'user', text: String(userText).slice(0, 2000) }];
  const proposals = [];
  for (let round = 0; round < 4; round++) {
    const out = await provider.step(history, declarations);
    if (out.fallback) ctx.store.audit('system', 'ai_fallback', { reason: String(out.fallback).slice(0, 200) });
    if (!out.calls?.length) {
      const reply = out.fallback ? `${out.text}\n\n(Gemini was unavailable, so this answer came from the built-in parser.)` : out.text;
      return { reply, proposals, history: [...history, { role: 'model', text: out.text }] };
    }
    history.push({ role: 'model', calls: out.calls, raw: out.raw });
    for (const c of out.calls) {
      const result = runTool(c.name, c.args, ctx);
      ctx.store.audit('agent', 'tool_call', { tool: c.name, ok: result.ok });
      if (result.pending_approval) proposals.push(result.pending_approval);
      history.push({ role: 'tool', name: c.name, result });
    }
  }
  return { reply: 'I stopped after several steps. Please check the cards below.', proposals, history };
}

module.exports = { createProvider, runAgent, SYSTEM };
