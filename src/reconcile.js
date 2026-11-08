// Matches incoming PayPal transactions (from Transaction Search) to open invoices.
// Deterministic and explainable on purpose: every suggestion carries its reasons, and nothing is
// marked paid until a human approves it.
const { effectiveStatus } = require('./agent/tools');

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
const domain = (e) => String(e || '').split('@')[1] || '';

function scorePair(txn, inv) {
  const reasons = [];
  let score = 0;
  if (txn.invoiceId && (txn.invoiceId === inv.paypalId || txn.invoiceId === inv.number)) { score += 10; reasons.push('PayPal links this payment to the invoice'); }
  if (txn.currency !== inv.currency) return { score: 0, reasons: ['different currency'] };
  if (Math.abs(txn.amount - inv.amount) < 0.005) { score += 4; reasons.push('exact amount'); }
  else if (txn.amount < inv.amount && txn.amount >= inv.amount * 0.5) { score += 1; reasons.push(`partial amount (${txn.amount} of ${inv.amount})`); }
  if (txn.payerEmail && txn.payerEmail === inv.clientEmail) { score += 4; reasons.push('same email as the client'); }
  else if (txn.payerEmail && domain(txn.payerEmail) && domain(txn.payerEmail) === domain(inv.clientEmail)) { score += 2; reasons.push('same email domain'); }
  const nameHits = words(inv.clientName).filter((w) => words(txn.payerName).includes(w));
  if (nameHits.length) { score += 2; reasons.push('payer name matches client'); }
  const noteHits = words(inv.description).filter((w) => words(txn.note).includes(w));
  if (noteHits.length) { score += 1; reasons.push(`note mentions "${noteHits[0]}"`); }
  return { score, reasons };
}

function matchPayments(transactions, invoices, { now = Date.now(), alreadyMatched = [] } = {}) {
  const incoming = transactions.filter((t) => t.amount > 0 && t.status === 'S' && !String(t.eventCode || '').startsWith('T19') && !alreadyMatched.includes(t.id));
  const open = invoices.filter((i) => ['SENT', 'OVERDUE'].includes(effectiveStatus(i, now)));
  const used = new Set();
  const suggestions = [];
  const unmatched = [];
  for (const txn of incoming) {
    let best = null;
    for (const inv of open) {
      if (used.has(inv.id)) continue;
      const s = scorePair(txn, inv);
      if (!best || s.score > best.score) best = { inv, ...s };
    }
    // Needs at least two independent signals (e.g. amount + email), or an explicit PayPal link.
    if (best && best.score >= 6) {
      used.add(best.inv.id);
      suggestions.push({ transaction: txn, invoiceId: best.inv.id, number: best.inv.number, clientName: best.inv.clientName, confidence: best.score >= 8 ? 'high' : 'medium', reasons: best.reasons });
    } else {
      unmatched.push({ ...txn, closest: best && best.score > 0 ? { number: best.inv.number, clientName: best.inv.clientName, reasons: best.reasons } : null });
    }
  }
  const linkedPaid = transactions.filter((t) => t.invoiceId && invoices.some((i) => i.status === 'PAID' && (i.paypalId === t.invoiceId || i.number === t.invoiceId))).length;
  return { suggestions, unmatched, scanned: incoming.length, alreadyPaid: linkedPaid };
}

module.exports = { matchPayments, scorePair };
