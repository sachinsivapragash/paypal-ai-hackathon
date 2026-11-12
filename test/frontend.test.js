const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// The server tests never load the browser code, so a typo in public/app.js could ship and break the
// whole page. Syntax-check every browser script, and make sure index.html references only real files.
test('frontend scripts parse', () => {
  const dir = path.join(__dirname, '..', 'public');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'pipe' }), `${f} has a syntax error`);
  }
});

test('index.html: every element id used by app.js via $("#…") exists', () => {
  const pub = path.join(__dirname, '..', 'public');
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
  const ids = new Set([...js.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)].map((m) => m[1]));
  const dynamic = new Set(['grid', 'gridEmpty', 'reconcileBtn']); // created at runtime or inside rendered markup
  const missing = [...ids].filter((id) => !dynamic.has(id) && !html.includes(`id="${id}"`) && !js.includes(`id="${id}"`));
  assert.deepStrictEqual(missing, []);
});
