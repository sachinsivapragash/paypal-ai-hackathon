// Tiny JSON-file store. Good enough for a single-user demo; swap for SQLite/Postgres later.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createStore(file) {
  let db = { invoices: [], pending: [], audit: [], webhookEvents: [] };
  if (file && fs.existsSync(file)) {
    try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* corrupt file -> start fresh */ }
  }
  const save = () => {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(db, null, 2));
  };
  const id = (p) => `${p}_${crypto.randomBytes(5).toString('hex')}`;

  return {
    db,
    id,
    save,
    audit(actor, action, details = {}) {
      const entry = { id: id('aud'), at: new Date().toISOString(), actor, action, details };
      db.audit.unshift(entry);
      db.audit = db.audit.slice(0, 500);
      save();
      return entry;
    },
    upsertInvoice(inv) {
      const i = db.invoices.findIndex((x) => x.id === inv.id);
      if (i >= 0) db.invoices[i] = { ...db.invoices[i], ...inv }; else db.invoices.unshift(inv);
      save();
      return db.invoices.find((x) => x.id === inv.id);
    },
    findInvoice(q) {
      if (!q) return null;
      const s = String(q).toLowerCase();
      return db.invoices.find((x) => x.id.toLowerCase() === s || (x.number || '').toLowerCase() === s)
        || db.invoices.find((x) => x.status !== 'CANCELLED' && x.status !== 'PAID' && x.clientName.toLowerCase().includes(s))
        || db.invoices.find((x) => x.clientName.toLowerCase().includes(s));
    },
    addPending(p) { db.pending.unshift(p); save(); return p; },
    getPending(pid) { return db.pending.find((p) => p.id === pid); },
    seenWebhook(eventId) { return db.webhookEvents.includes(eventId); },
    markWebhook(eventId) { db.webhookEvents.push(eventId); db.webhookEvents = db.webhookEvents.slice(-1000); save(); },
    reset() { db.invoices = []; db.pending = []; db.audit = []; db.webhookEvents = []; save(); },
  };
}

module.exports = { createStore };
