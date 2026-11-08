const { createApp } = require('../src/app');
const { createStore } = require('../src/store');

function testConfig(over = {}) {
  return {
    port: 0, paypal: { clientId: '', clientSecret: '', apiBase: 'https://api-m.sandbox.paypal.com', invoicerEmail: '', webhookId: 'WH-TEST' },
    ai: { provider: 'demo' }, maxInvoiceAmount: 5000, maxPayoutAmount: 500, dataFile: null, paypalDemo: true, aiDemo: true, ...over,
  };
}

async function start(cfg = testConfig(), deps = {}) {
  const store = deps.store || createStore(null);
  const app = createApp(cfg, { store, ...deps });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (p, body = {}, headers = {}) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
  return { app, store, server, post, get, close: () => new Promise((r) => server.close(r)) };
}

module.exports = { start, testConfig };
