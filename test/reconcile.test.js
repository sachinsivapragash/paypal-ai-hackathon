const test = require('node:test');
const assert = require('node:assert');
const { matchPayments } = require('../src/reconcile');
const { createPayPal, normalizeTxn } = require('../src/paypal');
const { start } = require('./helpers');

const inv = (o) => ({ currency: 'USD', status: 'SENT', dueDate: '2099-01-01', ...o });
const txn = (o) => ({ currency: 'USD', status: 'S', eventCode: 'T0000', invoiceId: null, date: '2026-11-07', ...o });

test('matching: amount + payer email = high confidence; amount alone is not enough', () => {
  const invoices = [
    inv({ id: 'a', number: '1', clientName: 'Northwind Cafe', clientEmail: 'owner@northwind.example.com', amount: 280, description: 'Photo edits' }),
    inv({ id: 'b', number: '2', clientName: 'Kestrel Labs', clientEmail: 'finance@kestrel.example.com', amount: 75, description: 'A/B test' }),
  ];
  const r = matchPayments([
    txn({ id: 't1', amount: 280, payerEmail: 'owner@northwind.example.com', payerName: 'Northwind Cafe', note: 'photo edits' }),
    txn({ id: 't2', amount: 75, payerEmail: 'sam@unknown.example.com', payerName: 'Sam Rivera' }),
  ], invoices);
  assert.strictEqual(r.suggestions.length, 1);
  assert.strictEqual(r.suggestions[0].invoiceId, 'a');
  assert.strictEqual(r.suggestions[0].confidence, 'high');
  assert.ok(r.suggestions[0].reasons.includes('exact amount'));
  assert.strictEqual(r.unmatched.length, 1, 'same amount from a stranger is NOT auto-matched');
  assert.strictEqual(r.unmatched[0].closest.number, '2');
});

test('matching ignores outgoing, failed, funding and already-queued transactions, and never double-assigns an invoice', () => {
  const invoices = [inv({ id: 'a', number: '1', clientName: 'Acme', clientEmail: 'ap@acme.example.com', amount: 100 })];
  const r = matchPayments([
    txn({ id: 'out', amount: -100, payerEmail: 'ap@acme.example.com' }),
    txn({ id: 'fail', amount: 100, status: 'D', payerEmail: 'ap@acme.example.com' }),
    txn({ id: 'fund', amount: 5000, eventCode: 'T1900' }),
    txn({ id: 'queued', amount: 100, payerEmail: 'ap@acme.example.com' }),
    txn({ id: 'ok1', amount: 100, payerEmail: 'ap@acme.example.com' }),
    txn({ id: 'ok2', amount: 100, payerEmail: 'ap@acme.example.com' }),
  ], invoices, { alreadyMatched: ['queued'] });
  assert.strictEqual(r.scanned, 2);
  assert.deepStrictEqual(r.suggestions.map((s) => s.transaction.id), ['ok1']);
  assert.strictEqual(r.unmatched[0].id, 'ok2');
});

test('PayPal client: Transaction Search query and record-payment call', async () => {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'T', expires_in: 3600 }) };
    if (url.includes('/v1/reporting/transactions')) return { ok: true, status: 200, text: async () => JSON.stringify({ total_pages: 1, last_refreshed_datetime: '2026-11-08T07:59:59Z', transaction_details: [{ transaction_info: { transaction_id: 'X1', transaction_event_code: 'T0000', transaction_status: 'S', transaction_amount: { value: '45.00', currency_code: 'USD' }, transaction_initiation_date: '2026-11-08T09:00:00Z' }, payer_info: { email_address: 'Buyer@Example.com', payer_name: { given_name: 'John', surname: 'Doe' } } }] }) };
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const pp = createPayPal({ clientId: 'a', clientSecret: 'b', apiBase: 'https://api-m.sandbox.paypal.com' }, { fetchImpl: f });
  const r = await pp.searchTransactions(30);
  assert.deepStrictEqual(r.transactions[0], { id: 'X1', date: '2026-11-08', amount: 45, currency: 'USD', status: 'S', eventCode: 'T0000', invoiceId: null, payerEmail: 'buyer@example.com', payerName: 'John Doe', note: null });
  assert.match(calls[1].url, /start_date=.*end_date=.*fields=all/);
  await pp.recordPayment('INV2-9', { date: '2026-11-08', amount: 45, currency: 'USD', transactionId: 'X1' }, 'rk');
  const rec = calls.at(-1);
  assert.match(rec.url, /\/v2\/invoicing\/invoices\/INV2-9\/payments$/);
  assert.strictEqual(rec.opts.headers['PayPal-Request-Id'], 'rk');
  assert.strictEqual(JSON.parse(rec.opts.body).amount.value, '45.00');
  assert.strictEqual(normalizeTxn({}).amount, 0);
});

test('end to end (demo): seed, reconcile, approve the match -> invoice PAID; re-running does not duplicate cards', async () => {
  const t = await start();
  try {
    await t.post('/api/demo/seed');
    const r = await t.post('/api/reconcile');
    assert.strictEqual(r.status, 200);
    const nw = r.body.suggestions.find((s) => s.clientName === 'Northwind Cafe');
    assert.ok(nw, 'the $280 Northwind payment is matched');
    assert.ok(r.body.unmatched.some((u) => u.payerEmail === 'sam@unknown.example.com'));
    const again = await t.post('/api/reconcile');
    assert.strictEqual(again.body.suggestions.length, 0, 'already-queued transactions are skipped');
    const ok = await t.post(`/api/actions/${nw.pendingId}/approve`);
    assert.strictEqual(ok.status, 200);
    const paid = ok.body.state.invoices.find((i) => i.id === nw.invoiceId);
    assert.strictEqual(paid.status, 'PAID');
    assert.strictEqual(paid.matchedTransaction, 'DEMO-TXN-7NW1');
    const chat = await t.post('/api/chat', { message: 'Did anyone pay me outside an invoice?' });
    assert.match(chat.body.reply, /incoming PayPal payment/);
  } finally { await t.close(); }
});
