const test = require('node:test');
const assert = require('node:assert');
const { createPayPal } = require('../src/paypal');
const { start } = require('./helpers');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAASwAAAEsAQAAAABRBrPY';

test('PayPal QR code: parses the multipart/form-data response into a base64 PNG', async () => {
  const body = `--b1\r\nContent-Disposition: form-data; name="image"\r\nContent-Type: text/plain\r\n\r\n${PNG}\r\n--b1--`;
  const f = async (url, opts) => {
    if (url.endsWith('/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'T', expires_in: 3600 }) };
    assert.match(url, /\/v2\/invoicing\/invoices\/INV2-9\/generate-qr-code$/);
    assert.deepStrictEqual(JSON.parse(opts.body), { width: 300, height: 300, action: 'pay' });
    return { ok: true, status: 200, text: async () => body };
  };
  const pp = createPayPal({ clientId: 'a', clientSecret: 'b', apiBase: 'https://api-m.sandbox.paypal.com' }, { fetchImpl: f });
  assert.deepStrictEqual(await pp.invoiceQrCode('INV2-9'), { png: PNG });
  const bad = createPayPal({ clientId: 'a', clientSecret: 'b', apiBase: 'x' }, { fetchImpl: async (u) => (u.endsWith('/token') ? { ok: true, json: async () => ({ access_token: 'T', expires_in: 3600 }) } : { ok: true, status: 200, text: async () => 'garbage' }) });
  await assert.rejects(bad.invoiceQrCode('X'), /unexpected response/);
});

test('QR endpoint: only for unpaid invoices; demo mode answers without a PNG', async () => {
  const t = await start();
  try {
    const c = await t.post('/api/chat', { message: 'Invoice Acme Corp ap@acme.example.com 100 USD for logo work' });
    const a = await t.post(`/api/actions/${c.body.proposals[0].id}/approve`);
    const inv = a.body.state.invoices[0];
    const q = await t.get(`/api/invoices/${inv.id}/qr`);
    assert.strictEqual(q.status, 200);
    assert.strictEqual(q.body.png, null);
    assert.strictEqual(q.body.number, inv.number);
    await t.post(`/api/demo/pay/${inv.paypalId}`);
    const paid = await t.get(`/api/invoices/${inv.id}/qr`);
    assert.strictEqual(paid.status, 409);
  } finally { await t.close(); }
});

test('CSV export: headers, quoting, and spreadsheet formula injection neutralised', async () => {
  const t = await start();
  try {
    const c = await t.post('/api/chat', { message: 'Invoice Acme Corp ap@acme.example.com 100 USD for logo work' });
    await t.post(`/api/actions/${c.body.proposals[0].id}/approve`);
    t.store.db.invoices[0].description = '=HYPERLINK("http://evil.example.com","click"), with "quotes"';
    const r = await fetch(`http://127.0.0.1:${t.server.address().port}/api/export/invoices.csv`);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="duepilot-invoices-/);
    const text = (await r.text()).replace(/^﻿/, '');
    const [head, row] = text.trim().split('\r\n');
    assert.match(head, /^number,client,client_email,description,amount/);
    assert.ok(row.includes(`"'=HYPERLINK(""http://evil.example.com"",""click""), with ""quotes"""`), row);
    const audit = await (await fetch(`http://127.0.0.1:${t.server.address().port}/api/export/audit.csv`)).text();
    assert.match(audit, /time,actor,action,details/);
    assert.match(audit, /approved_create_invoice/);
  } finally { await t.close(); }
});
