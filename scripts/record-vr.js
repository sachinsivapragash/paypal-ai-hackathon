// Records a silent, captioned demo of Tallyspace (the VR/MR room) in sample mode, using its desktop
// mouse fallback. Output: video/tallyspace-raw.webm and an mp4 at the path given as the 2nd argument.
//   node scripts/record-vr.js [appUrl] [out.mp4]
// Dev tool only. Sample mode sends nothing to PayPal.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const FF = require('ffmpeg-static');

const APP = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', 'video');
const MP4 = process.argv[3] || path.join(OUT, 'tallyspace-demo.mp4');
const W = 1280, H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  const t0 = Date.now();
  await page.goto(`${APP}/vr/`);
  await page.addStyleTag({ content: '#cap{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);max-width:80%;background:#000c;color:#fff;font:600 24px system-ui;padding:12px 20px;border-radius:12px;z-index:50;text-align:center}#log,#VRButton,#ARButton{display:none!important}body{user-select:none}' });
  const cap = (text) => page.evaluate((t) => { let c = document.getElementById('cap'); if (!c) { c = document.createElement('div'); c.id = 'cap'; document.body.appendChild(c); } c.textContent = t; }, text);
  const at = (key) => page.evaluate((k) => window.tallyspace.locate(k), key);
  const drag = async (from, to, steps = 45) => {
    const a = await at(from); const b = await at(to);
    if (!a || !b) throw new Error(`cannot locate ${from} -> ${to}`);
    await page.mouse.move(a.x, a.y, { steps: 12 }); await sleep(500);
    await page.mouse.down(); await page.mouse.move(b.x, b.y - 40, { steps }); await sleep(250);
    await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  };
  const press = async (key) => { const p = await at(key); await page.mouse.move(p.x, p.y, { steps: 15 }); await sleep(400); await page.mouse.down(); await page.mouse.up(); };

  // Sample data (if the connected account already has invoices, switch to the sample room).
  await page.waitForFunction(() => window.tallyspace && document.querySelector('#src').textContent.match(/Sample|Live/));
  const lead = Math.max(0, (Date.now() - t0) / 1000 - 0.2); // loading time to trim from the start
  if (!(await page.textContent('#src')).startsWith('Sample')) await page.click('#sample');
  await page.click('#hudToggle').catch(() => {});

  await cap('Tallyspace: your unpaid invoices as things you can pick up');
  await sleep(4500);
  await cap('Height is the amount. Red is overdue, amber is waiting, green is paid.');
  await sleep(4000);

  await cap('Grab an overdue invoice and drop it in the Remind bin');
  await drag('overdue', 'bin:remind'); await sleep(2500);
  await cap('That only proposes the reminder. Nothing reaches PayPal until you approve it.');
  await sleep(3500);
  await cap('Drop the approval tablet on APPROVE to run it');
  await drag('tablet', 'bin:approve', 30); await sleep(3000);

  await cap('One button chases every overdue invoice at once');
  await press('btn:0'); await sleep(3000);
  await cap('Approve each one, and the combo meter rewards working fast');
  await drag('tablet', 'bin:approve', 30); await sleep(2600);
  await drag('tablet', 'bin:approve', 30); await sleep(2500);

  await cap('Changed your mind? Throw an invoice into Cancel, then reject or approve the tablet');
  await drag('sent', 'bin:cancel'); await sleep(2000);
  await drag('tablet', 'bin:reject', 30); await sleep(2500);

  await cap('Around you: cash-flow totals, a 4-week forecast, client risk orbs and the audit log');
  await page.mouse.move(W / 2, 200); await page.mouse.down({ button: 'right' });
  await page.mouse.move(W / 2 - 260, 215, { steps: 90 }); await sleep(600);
  await page.mouse.move(W / 2 + 260, 215, { steps: 160 }); await sleep(600);
  await page.mouse.move(W / 2, 200, { steps: 90 }); await page.mouse.up({ button: 'right' });
  await sleep(800);

  await cap('In a Quest headset: trigger or pinch to grab, talk to the Gemini agent, VR or mixed reality');
  await sleep(4500);
  await cap('Live mode runs on real PayPal sandbox invoices: reminders, QR codes, payments, webhooks');
  await sleep(4500);
  await cap('Tallyspace · tallyspace-vr.onrender.com');
  await sleep(3500);

  console.log(`recorded ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const video = page.video();
  await ctx.close();
  const raw = path.join(OUT, 'tallyspace-raw.webm');
  fs.rmSync(raw, { force: true });
  fs.renameSync(await video.path(), raw);
  await browser.close();
  execFileSync(FF, ['-y', '-ss', lead.toFixed(2), '-i', raw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-r', '30', '-movflags', '+faststart', MP4], { stdio: 'ignore' });
  console.log('wrote', MP4);
})().catch((e) => { console.error(e); process.exit(1); });
