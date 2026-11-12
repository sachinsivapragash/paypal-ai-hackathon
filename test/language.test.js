const test = require('node:test');
const assert = require('node:assert');
const { runTool } = require('../src/agent/tools');
const { createStore } = require('../src/store');

function storeWithInvoice() {
  const store = createStore(null);
  store.upsertInvoice({ id: 'inv_1', paypalId: 'P1', number: '0007', clientName: 'Lucía Gómez', clientEmail: 'lucia@example.com', amount: 120, currency: 'USD', status: 'SENT', dueDate: '2099-01-01' });
  return store;
}
const cfg = { maxInvoiceAmount: 5000, maxPayoutAmount: 500 };

test('reminder in another language keeps the language and an English summary for the approver', () => {
  const store = storeWithInvoice();
  const r = runTool('send_reminder', { invoice: '0007', language: 'spanish', message: 'Hola Lucía, te recuerdo con cariño que la factura #0007 sigue pendiente. ¡Gracias!', english_summary: 'Hi Lucía, a friendly reminder that invoice #0007 is still open. Thanks!' }, { store, config: cfg });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.preview.language, 'Spanish');
  assert.match(r.preview.englishSummary, /friendly reminder/);
  assert.match(store.getPending(r.pending_approval).data.message, /^Hola/);
});

test('English reminders carry no language tag', () => {
  const store = storeWithInvoice();
  const r = runTool('send_reminder', { invoice: '0007', message: 'Hi Lucía, friendly reminder!' }, { store, config: cfg });
  assert.strictEqual(r.preview.language, undefined);
  const r2 = runTool('send_reminder', { invoice: '0007', language: 'English', message: 'Hi again' }, { store, config: cfg });
  assert.strictEqual(r2.preview.language, undefined);
});
