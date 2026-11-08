// Autopilot: standing rules that let the agent act without a click, inside strict limits.
// Design rules (enforced here, not in the prompt):
//  - Off by default. Every auto-action is logged with the rule that allowed it.
//  - Money OUT (payouts) and cancellations can NEVER be automated.
//  - Anything that came from a pasted email (untrusted third-party text) always needs a human.
//  - A daily cap limits the total value Autopilot may invoice per day.

const HARD = { maxInvoiceAmount: 1000, maxDailyLimit: 2000 };

const DEFAULT_POLICY = {
  enabled: false,
  invoices: { enabled: false, maxAmount: 200, knownClientsOnly: true },
  reminders: { enabled: true },
  matching: { enabled: false }, // only high-confidence matches, and never if any other match is ambiguous
  dailyLimit: 500,
};

const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 100) / 100)) : d; };

function normalizePolicy(input = {}, base = DEFAULT_POLICY) {
  return {
    enabled: bool(input.enabled, base.enabled),
    invoices: {
      enabled: bool(input.invoices?.enabled, base.invoices.enabled),
      maxAmount: num(input.invoices?.maxAmount, base.invoices.maxAmount, 1, HARD.maxInvoiceAmount),
      knownClientsOnly: bool(input.invoices?.knownClientsOnly, base.invoices.knownClientsOnly),
    },
    reminders: { enabled: bool(input.reminders?.enabled, base.reminders.enabled) },
    matching: { enabled: bool(input.matching?.enabled, base.matching.enabled) },
    dailyLimit: num(input.dailyLimit, base.dailyLimit, 0, HARD.maxDailyLimit),
  };
}

const today = (now) => new Date(now).toISOString().slice(0, 10);

// Value Autopilot has already invoiced today (from the audit log, so it survives restarts with the data).
function autoSpentToday(audit, now = Date.now()) {
  return audit.filter((a) => a.actor === 'autopilot' && a.action === 'approved_create_invoice' && a.at.slice(0, 10) === today(now))
    .reduce((s, a) => s + (Number(a.details?.amount) || 0), 0);
}

// Decide whether a pending action may run without a human. Returns { auto, rule?, reason }.
function decide(pending, { policy, invoices, audit, now = Date.now() }) {
  const p = normalizePolicy(policy);
  const d = pending.data || {};
  if (!p.enabled) return { auto: false, reason: 'Autopilot is off' };
  if (pending.source === 'email') return { auto: false, reason: 'came from a pasted email, so a human must approve' };
  switch (pending.type) {
    case 'pay_contractor': return { auto: false, reason: 'payouts always need a human' };
    case 'cancel_invoice': return { auto: false, reason: 'cancellations always need a human' };
    case 'send_reminder':
      return p.reminders.enabled ? { auto: true, rule: 'reminders', reason: 'reminders are on autopilot' } : { auto: false, reason: 'reminder autopilot is off' };
    case 'create_invoice': {
      if (!p.invoices.enabled) return { auto: false, reason: 'invoice autopilot is off' };
      if (d.amount > p.invoices.maxAmount) return { auto: false, reason: `over the autopilot limit of ${p.invoices.maxAmount}` };
      const known = invoices.some((i) => i.clientEmail === d.clientEmail && i.status === 'PAID');
      if (p.invoices.knownClientsOnly && !known) return { auto: false, reason: 'new client (only clients who have paid before are automatic)' };
      const spent = autoSpentToday(audit, now);
      if (spent + d.amount > p.dailyLimit) return { auto: false, reason: `would pass today's autopilot cap (${spent} of ${p.dailyLimit} used)` };
      return { auto: true, rule: 'invoices', reason: `${known ? 'returning client, ' : ''}${d.amount} ≤ ${p.invoices.maxAmount}, within today's cap` };
    }
    case 'record_payment':
      if (!p.matching.enabled) return { auto: false, reason: 'matching autopilot is off' };
      if (d.confidence !== 'high') return { auto: false, reason: 'only high-confidence matches are automatic' };
      return { auto: true, rule: 'matching', reason: `high-confidence match (${(d.reasons || []).join(', ')})` };
    default: return { auto: false, reason: 'not eligible' };
  }
}

module.exports = { DEFAULT_POLICY, HARD, normalizePolicy, decide, autoSpentToday };
