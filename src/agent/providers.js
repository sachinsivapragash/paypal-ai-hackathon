// Swappable LLM providers. Interface:
//   provider.step(history, declarations) -> { text?: string, calls?: [{ name, args }] }
// history items: { role: 'user'|'model', text } | { role: 'model', calls } | { role: 'tool', name, result }

function gemini({ apiKey, model, fallbackModel, fetchImpl = globalThis.fetch, system }) {
  const toContents = (history) => history.map((h) => {
    if (h.role === 'tool') return { role: 'user', parts: [{ functionResponse: { name: h.name, response: h.result } }] };
    // Gemini 3 requires its own parts (incl. thoughtSignature) to be sent back unchanged.
    if (h.calls) return { role: 'model', parts: h.raw || h.calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) };
    return { role: h.role, parts: [{ text: h.text }] };
  });
  // On rate limits (429) or overload (503), retry once on the lite model, which has its own free-tier quota.
  const models = [model, ...(fallbackModel && fallbackModel !== model ? [fallbackModel] : [])];
  async function call(m, history, declarations) {
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(25_000), // never leave the user staring at "thinking…"
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: toContents(history),
          tools: [{ functionDeclarations: declarations }],
          generationConfig: { temperature: 0.2 },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(`Gemini error: ${body.error?.message || res.status}`); e.status = res.status; throw e; }
      const parts = body.candidates?.[0]?.content?.parts || [];
      const calls = parts.filter((p) => p.functionCall).map((p) => ({ name: p.functionCall.name, args: p.functionCall.args || {} }));
      const text = parts.filter((p) => p.text).map((p) => p.text).join('').trim();
      return calls.length ? { calls, text, raw: parts } : { text: text || "Sorry, I didn't catch that." };
  }
  return {
    name: `gemini:${model}`,
    async step(history, declarations) {
      for (let i = 0; ; i++) {
        try { return await call(models[i], history, declarations); } catch (e) {
          const transient = e.status === 429 || e.status === 503 || e.name === 'TimeoutError';
          if (!transient || i === models.length - 1) throw e;
        }
      }
    },
  };
}

// Keyless demo "model": deterministic parser that emits the SAME tool calls a real model would.
// Lets judges try every flow with zero keys. Clearly labelled as demo mode in the UI.
function demo() {
  const money = /(?:\$|usd\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(usd|eur|gbp|cad|aud|jpy|sgd|dollars|euros|pounds)?/i;
  const EMAIL_RE = /[^\s@,<>()]+@[^\s@,<>()]+\.[a-z]{2,}/gi;
  const cur = { dollars: 'USD', euros: 'EUR', pounds: 'GBP' };
  function parse(text) {
    const t = text.trim();
    const lower = t.toLowerCase();
    if (/\b(reconcile|match (?:the |my )?payments?|pa(?:y|id) (?:me )?outside|anyone pa(?:y|id)|who paid|unmatched payments?|transaction search)\b/.test(lower)) return [{ name: 'reconcile_payments', args: {} }];
    const intake = t.match(/<client_email>([\s\S]*)<\/client_email>/i);
    if (intake) return parseEmail(intake[1]);
    const isInvoiceRequest = /^(please\s+)?(invoice|bill|charge)\b/.test(lower);
    if (/\b(who should i (chase|remind|follow up)|insights?|risk|late payers?|slow payers?|who pays)\b/.test(lower)) return [{ name: 'client_insights', args: {} }];
    if (!isInvoiceRequest && /\b(remind|nudge|follow up|chase)\b/.test(lower)) {
      const who = lower.match(/(?:remind|nudge|chase|follow up with)\s+([a-z0-9 .&'-]+?)(?:\s+about|\s+for|$|[,.!])/i)?.[1]?.trim();
      const target = who && who !== 'them' ? who : (lower.match(/#?(\d{4,})/)?.[1] || '');
      return [{ name: 'send_reminder', args: { invoice: target, message: `Hi! Just a friendly nudge that your invoice is still open. If it's already on its way, thank you and please ignore this. Happy to help if anything is unclear.` } }];
    }
    if (/\b(pay|payout|send money)\b/.test(lower) && !/\binvoice\b/.test(lower)) {
      const email = t.match(/[^\s@,<>()]+@[^\s@,<>()]+\.[a-z]{2,}/i)?.[0] || '';
      const amt = t.replace(EMAIL_RE, ' ').match(money);
      const note = t.match(/\bfor\s+(?:the\s+)?(.+?)(?:[,.]|$)/i)?.[1] || 'Contract work';
      return [{ name: 'pay_contractor', args: { recipient_email: email, amount: amt ? Number(amt[1].replace(/,/g, '')) : NaN, currency: amt?.[2] ? (cur[amt[2].toLowerCase()] || amt[2].toUpperCase()) : 'USD', note } }];
    }
    if (/\bcancel\b/.test(lower)) {
      const target = lower.match(/cancel\s+(?:the\s+)?(?:invoice\s+)?(?:for\s+|to\s+)?#?([a-z0-9 .&'-]+?)(?:'s)?(?:\s+invoice)?(?:$|[,.!])/i)?.[1]?.trim() || '';
      return [{ name: 'cancel_invoice', args: { invoice: target } }];
    }
    if (/\b(summary|cash ?flow|how much|owed|outstanding|overview)\b/.test(lower)) return [{ name: 'cash_flow_summary', args: {} }];
    if (/\b(list|show|unpaid|overdue|paid)\b/.test(lower) && !/\binvoice\s+[a-z]/i.test(lower.replace(/invoices/, ''))) {
      const status = lower.includes('overdue') ? 'OVERDUE' : lower.includes('unpaid') ? 'SENT' : lower.includes('paid') ? 'PAID' : undefined;
      return [{ name: 'list_invoices', args: status ? { status } : {} }];
    }
    if (/\b(invoice|bill|charge)\b/.test(lower)) {
      const name = t.match(/(?:[Ii]nvoice|[Bb]ill|[Cc]harge)\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*)*)/)?.[1]
        || t.match(/(?:invoice|bill|charge)\s+([\w&'.-]+)/i)?.[1];
      const email = t.match(/[^\s@,<>()]+@[^\s@,<>()]+\.[a-z]{2,}/i)?.[0];
      const amt = t.replace(EMAIL_RE, ' ').replace(/net\s*\d+/i, '').replace(/\d+\s*(?:days|reminders?)/gi, '').match(money);
      const net = Number(t.match(/net\s*(\d+)/i)?.[1] ?? t.match(/(\d+)\s*days/i)?.[1] ?? 7);
      const remWord = { once: 1, twice: 2, thrice: 3, 'three times': 3 };
      const remMatch = lower.match(/remind(?: them)?\s+(once|twice|thrice|three times|(\d)\s*times?)/);
      const reminders = remMatch ? (remWord[remMatch[1]] ?? Number(remMatch[2])) : (/\bremind/.test(lower) ? 1 : 1);
      const desc = t.match(/\bfor\s+(?:the\s+)?(.+?)(?:,|\.|\s+net\b|\s+due\b|\s+remind\b|$)/i)?.[1] || 'Professional services';
      const slug = (name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '');
      return [{ name: 'create_invoice', args: {
        client_name: name || '', client_email: email || `billing@${slug}.example.com`,
        amount: amt ? Number(amt[1].replace(/,/g, '')) : NaN, currency: amt?.[2] ? (cur[amt[2].toLowerCase()] || amt[2].toUpperCase()) : 'USD',
        description: desc.replace(/^(?:the\s+)/i, ''), net_days: net, reminders,
      } }];
    }
    return null;
  }
  // Keyless extraction from a pasted client email: sender, "N things at $X each", "$X for thing".
  function parseEmail(body) {
    const from = body.match(/^\s*from:\s*(.*)$/im)?.[1] || '';
    const email = (from.match(EMAIL_RE) || body.match(EMAIL_RE) || [''])[0];
    let name = from.replace(EMAIL_RE, '').replace(/[<>"]/g, '').trim();
    if (!name) name = body.match(/(?:thanks|regards|cheers|best),?\s*\n+\s*([A-Z][^\n]{1,40})/i)?.[1]?.trim() || '';
    if (!name && email) name = email.split('@')[1].split('.')[0].replace(/^\w/, (c) => c.toUpperCase());
    const text = body.replace(EMAIL_RE, ' ');
    const items = [];
    const re = /(\d+)\s*(?:x\s*)?([a-z][a-z \-]{2,40}?)\s*(?:at|@)\s*\$?\s*(\d[\d,]*(?:\.\d{1,2})?)(?:\s*each)?/gi;
    let m;
    while ((m = re.exec(text))) items.push({ name: m[2].trim().replace(/^\w/, (c) => c.toUpperCase()), quantity: Number(m[1]), unit_amount: Number(m[3].replace(/,/g, '')) });
    const re2 = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:for|–|-)\s*(?:the\s+|a\s+|an\s+)?([a-z][a-z \-]{2,40})/gi;
    if (!items.length) while ((m = re2.exec(text))) items.push({ name: m[2].trim().replace(/^\w/, (c) => c.toUpperCase()), quantity: 1, unit_amount: Number(m[1].replace(/,/g, '')) });
    const desc = items.length ? items.map((i) => i.name).join(', ') : 'Professional services';
    return [{ name: 'create_invoice', args: { client_name: name, client_email: email, items, description: desc, net_days: 7, reminders: 1 } }];
  }
  function describe(name, r) {
    if (!r.ok) return `I couldn't do that: ${r.errors.join('; ')}.`;
    if (name === 'create_invoice') return `I drafted an invoice for ${r.preview.clientName}: ${r.preview.amount} ${r.preview.currency} for "${r.preview.description}"${r.preview.items ? ` (${r.preview.items.length} line items)` : ''}, due in ${r.preview.netDays} days with ${r.preview.reminders} reminder(s). Please review and approve it on the card.`;
    if (name === 'send_reminder') return `Here's a reminder for invoice #${r.preview.number} (${r.preview.clientName}). Approve it to send through PayPal.`;
    if (name === 'client_insights') {
      if (!r.clients.length) return 'No payment history yet. Send a few invoices first.';
      const chase = r.clients.filter((c) => c.open > 0);
      const lines = r.clients.map((c) => `• ${c.client}: ${c.risk} risk · owes ${c.owed} · avg ${c.avgDaysToPay ?? 'n/a'} days to pay · ${c.lateRate}% late`);
      return (chase.length ? `Chase ${chase[0].client} first (${chase[0].risk} risk, owes ${chase[0].owed}).\n` : 'Nobody owes you right now.\n') + lines.join('\n');
    }
    if (name === 'reconcile_payments') {
      const s = r.suggestions.map((x) => `• ${x.amount} from ${x.client} → invoice #${x.invoice} (${x.confidence}: ${x.reasons.join(', ')})`);
      const u = r.unmatched.map((x) => `• ${x.amount} from ${x.payer || 'unknown'} on ${x.date}: no matching invoice`);
      return `I checked ${r.scanned} incoming PayPal payment(s).` + (s.length ? `\nPossible matches (approve to mark paid):\n${s.join('\n')}` : '\nNo new matches.') + (u.length ? `\nUnmatched:\n${u.join('\n')}` : '');
    }
    if (name === 'pay_contractor') return `Payout ready: ${r.preview.amount} ${r.preview.currency} to ${r.preview.recipientEmail} for "${r.preview.note}". No money moves until you approve.`;
    if (name === 'cancel_invoice') return `Ready to cancel invoice #${r.preview.number} for ${r.preview.clientName}. Approve to confirm.`;
    if (name === 'list_invoices') return r.invoices.length ? `You have ${r.invoices.length} matching invoice(s):\n` + r.invoices.map((i) => `• #${i.number} ${i.client}: ${i.amount} ${i.currency} (${i.status})`).join('\n') : 'No matching invoices yet.';
    if (name === 'cash_flow_summary') return `Paid: ${r.paid} · Outstanding: ${r.outstanding} · Overdue: ${r.overdue}.` + (r.topDebtor ? ` ${r.topDebtor.name} owes the most (${r.topDebtor.amount}).` : '');
    return 'Done.';
  }
  return {
    name: 'demo (keyless rule-based)',
    async step(history) {
      const last = history[history.length - 1];
      if (last.role === 'tool') return { text: describe(last.name, last.result) };
      const calls = parse(last.text || '');
      if (!calls) return { text: 'Try: "Invoice Acme Corp ap@acme.com 450 USD for the logo work, net 7, remind them twice", "show unpaid invoices", "remind Acme" or "cash flow summary".' };
      return { calls };
    },
  };
}

module.exports = { gemini, demo };
