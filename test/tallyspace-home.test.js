const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { start } = require('./helpers');

const getHome = (port, host) => new Promise((resolve, reject) => {
  const req = http.request({ port, path: '/', headers: host ? { Host: host } : {} }, (res) => { res.resume(); resolve({ status: res.statusCode, location: res.headers.location }); });
  req.on('error', reject); req.end();
});

test('tallyspace host opens straight into the VR room; other hosts keep the web app', async () => {
  const t = await start();
  try {
    const port = t.server.address().port;
    assert.deepStrictEqual(await getHome(port, 'tallyspace-vr.onrender.com'), { status: 302, location: '/vr/' });
    assert.strictEqual((await getHome(port)).status, 200);
  } finally { await t.close(); }
});
