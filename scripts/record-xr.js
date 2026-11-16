// Records a captioned demo of Tallyspace running in Meta's WebXR emulator (IWER) as a Quest 3,
// seated, with hand tracking only (no controllers). Sample data: nothing is sent anywhere.
//   node scripts/record-xr.js [appUrl] [out.mp4]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const FF = require('ffmpeg-static');

const APP = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', 'video');
const MP4 = process.argv[3] || path.join(OUT, 'tallyspace-xr.mp4');
const W = 1280, H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the page: smooth hand moves, aiming, pinching and head turns on the emulated Quest.
const PAGE_HELPERS = () => {
  const d = window.xrdev; const w = (ms) => new Promise((r) => setTimeout(r, ms));
  const qAim = (v) => { const n = Math.hypot(...v); v = v.map((x) => x / n); const c = [v[1], -v[0], 0]; const ww = 1 - v[2]; const m = Math.hypot(c[0], c[1], c[2], ww); return [c[0] / m, c[1] / m, c[2] / m, ww / m]; };
  const slerp = (a, b, t) => { let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; if (dot < 0) { b = b.map((x) => -x); dot = -dot; } const r = a.map((x, i) => x + (b[i] - x) * t); const m = Math.hypot(...r); return r.map((x) => x / m); };
  const ease = (t) => t * t * (3 - 2 * t);
  window.xr = {
    async hand(h, pos, target, ms = 700) {
      const hand = d.hands[h]; const p0 = [hand.position.x, hand.position.y, hand.position.z]; const q0 = [hand.quaternion.x, hand.quaternion.y, hand.quaternion.z, hand.quaternion.w];
      const steps = Math.max(1, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps); const p = p0.map((x, k) => x + (pos[k] - x) * t); hand.position.set(...p);
        const tg = typeof target === 'string' ? window.tallyspace.world(target) : target;
        if (tg) { const q1 = qAim([tg[0] - p[0], tg[1] - p[1], tg[2] - p[2]]); hand.quaternion.set(...slerp(q0, q1, t)); }
        await w(16);
      }
    },
    async pinch(h, v, ms = 350) { d.hands[h].updatePinchValue(v); await w(ms); },
    async head(pitchDeg, yawDeg, ms = 900) {
      const toQ = (p, y) => { const cp = Math.cos(p / 2), sp = Math.sin(p / 2), cy = Math.cos(y / 2), sy = Math.sin(y / 2); return [sp * cy, cp * sy, -sp * sy, cp * cy]; };
      const q0 = [d.quaternion.x, d.quaternion.y, d.quaternion.z, d.quaternion.w]; const q1 = toQ(pitchDeg * Math.PI / 180, yawDeg * Math.PI / 180);
      const steps = Math.max(1, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) { d.quaternion.set(...slerp(q0, q1, ease(i / steps))); await w(16); }
    },
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  const t0 = Date.now();
  await page.goto(`${APP}/vr/?emulate&nointro`);
  await page.waitForFunction(() => window.xrdev && window.tallyspace && /Sample|Live/.test(document.querySelector('#src').textContent));
  if (!(await page.textContent('#src')).startsWith('Sample')) await page.click('#sample');
  await page.evaluate(PAGE_HELPERS);
  await page.addStyleTag({ content: '#cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:82%;background:#000c;color:#fff;font:600 26px system-ui;padding:12px 22px;border-radius:12px;z-index:2147483647;text-align:center}#tag{position:fixed;left:16px;top:14px;background:#000a;color:#9fe3ff;font:600 15px system-ui;padding:6px 12px;border-radius:8px;z-index:2147483647}' });
  const cap = (text) => page.evaluate((t) => { let c = document.getElementById('cap'); if (!c) { c = document.createElement('div'); c.id = 'cap'; document.body.appendChild(c); } c.textContent = t; }, text);
  const x = (fn, ...args) => page.evaluate(([f, a]) => window.xr[f](...a), [fn, args]);

  await page.evaluate(() => window.xrdev.position.set(0, 1.2, 0.15)); // seated eye height, before the room fits itself
  await page.getByRole('button', { name: 'ENTER VR' }).click();
  await page.waitForFunction(() => window.xrdev.activeSession);
  await page.evaluate(() => {
    const t = document.createElement('div'); t.id = 'tag'; t.textContent = 'Meta Quest 3 · WebXR emulator (IWER) · seated · hand tracking only'; document.body.appendChild(t);
    const d = window.xrdev;
    d.hands.right.position.set(0.18, 0.75, -0.25); d.hands.left.position.set(-0.18, 0.75, -0.25);
  });
  const lead = Math.max(0, (Date.now() - t0) / 1000 - 0.3);
  await x('head', -18, 0, 10);

  await cap('Tallyspace: the money clients owe you, as objects you can hold');
  await sleep(4000);
  await cap('Seated, hands only. Taller means more money. Red is overdue.');
  await x('head', -18, 18, 1400); await x('head', -18, -18, 2200); await x('head', -18, 0, 1200);

  await cap('Pinch an overdue invoice to grab it…');
  await x('hand', 'right', [0.16, 0.78, -0.3], 'overdue', 900);
  await x('pinch', 'right', 1, 900);
  await cap('…point at Remind and let go. No throwing, no standing up.');
  await x('hand', 'right', [0.14, 0.75, -0.28], 'bin:remind', 1100);
  await x('pinch', 'right', 0, 1500);

  await cap('Nothing happens yet. You approve it by dropping the tablet on APPROVE.');
  await x('hand', 'right', [0.1, 0.78, -0.3], 'tablet', 1000);
  await x('pinch', 'right', 1, 900);
  await x('hand', 'right', [0.08, 0.76, -0.3], 'bin:approve', 1100);
  await x('pinch', 'right', 0, 2200);

  await cap('Buttons are in reach too: “Chase overdue” proposes a reminder for every late invoice');
  await x('hand', 'right', [0.12, 0.76, -0.3], 'btn:0', 900);
  await x('pinch', 'right', 1, 800); await x('pinch', 'right', 0, 2000);

  await cap('Approve them one after another to build a combo');
  for (let i = 0; i < 2; i++) {
    await x('hand', 'right', [0.1, 0.78, -0.3], 'tablet', 800);
    await x('pinch', 'right', 1, 800);
    await x('hand', 'right', [0.08, 0.76, -0.3], 'bin:approve', 900);
    await x('pinch', 'right', 0, 1400);
  }

  await cap('Ask the assistant with one pinch: “Who should I chase first?”');
  await x('head', -14, -22, 1000);
  await x('hand', 'left', [0.2, 0.76, -0.32], 'btn:5', 900);
  await x('pinch', 'left', 1, 800); await x('pinch', 'left', 0, 3200);
  await x('head', -16, 0, 900);

  await cap('Above you: totals, a 4-week cash forecast and your combo');
  await x('head', 12, 0, 1400); await sleep(2600); await x('head', 12, 30, 1400); await sleep(1200); await x('head', -16, 0, 1400);

  await cap('Changed your mind? Cancel, then reject the tablet. Every action is logged.');
  await x('hand', 'right', [0.16, 0.78, -0.3], 'sent', 900);
  await x('pinch', 'right', 1, 800);
  await x('hand', 'right', [0.16, 0.75, -0.28], 'bin:cancel', 1000);
  await x('pinch', 'right', 0, 1400);
  await x('hand', 'right', [0.1, 0.78, -0.3], 'tablet', 900);
  await x('pinch', 'right', 1, 800);
  await x('hand', 'right', [0.08, 0.76, -0.3], 'bin:reject', 1000);
  await x('pinch', 'right', 0, 1800);

  await cap('In mixed reality, pinch a real surface to place the ledger in your room');
  await sleep(3800);
  await cap('Live mode runs on real sandbox invoices, payments and an AI assistant');
  await sleep(3800);
  await cap('Tallyspace · tallyspace-vr.onrender.com');
  await sleep(3200);

  console.log(`recorded ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const video = page.video();
  await ctx.close();
  const raw = path.join(OUT, 'tallyspace-xr-raw.webm');
  fs.rmSync(raw, { force: true });
  fs.renameSync(await video.path(), raw);
  await browser.close();
  execFileSync(FF, ['-y', '-ss', lead.toFixed(2), '-i', raw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-r', '30', '-movflags', '+faststart', MP4], { stdio: 'ignore' });
  console.log('wrote', MP4);
})().catch((e) => { console.error(e); process.exit(1); });
