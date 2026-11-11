// Records the demo video (no audio) by driving a real browser through VIDEO_SCRIPT.md
// against the live app. Output: video/raw.webm + video/scenes.json (start time of each scene).
//   node scripts/record-demo.js [appUrl]
// Needs DEMO_BUYER_PASSWORD in .env (sandbox test buyer). Dev tool only.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const APP = process.argv[2] || 'https://duepilot-4f2q.onrender.com';
const BUYER = 'sb-ratla53771659@personal.example.com';
const OUT = path.join(__dirname, '..', 'video');
const W = 1280, H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // 1) Off camera: log the sandbox buyer in, so paying is one click on camera.
  const loginCtx = await browser.newContext({ viewport: { width: W, height: H } });
  const lp = await loginCtx.newPage();
  await lp.goto('https://www.sandbox.paypal.com/signin');
  await lp.getByPlaceholder('Email or mobile number').fill(BUYER);
  await lp.getByRole('button', { name: 'Next' }).click();
  await lp.getByPlaceholder('Password').fill(process.env.DEMO_BUYER_PASSWORD);
  await lp.getByRole('button', { name: 'Log In' }).click();
  await lp.waitForURL(/myaccount/, { timeout: 30000 });
  const storage = await loginCtx.storageState();
  await loginCtx.close();
  console.log('buyer logged in (off camera)');

  // 2) Off camera: wake the app and reset its data.
  await fetch(`${APP}/api/status`).catch(() => {});
  await fetch(`${APP}/api/reset`, { method: 'POST' });

  // 3) On camera.
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, storageState: storage, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const t0 = Date.now();
  let popup = null, popupT0 = 0, popupT1 = 0;
  const scenes = [];
  // Waiting periods (Gemini thinking, webhook delivery) get cut to ~1.5 s when the video is assembled.
  const cuts = [];
  const now = () => (Date.now() - t0) / 1000;
  const scene = (name) => { scenes.push({ name, at: (Date.now() - t0) / 1000 }); console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${name}`); };

  // A visible cursor (headless recordings have none), so viewers can follow the clicks.
  const addCursor = () => page.evaluate(() => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div');
    c.id = '__cur';
    c.style.cssText = 'position:fixed;z-index:2147483647;width:22px;height:22px;border-radius:50%;background:rgba(79,70,229,.35);border:2px solid #4f46e5;pointer-events:none;transform:translate(-50%,-50%);transition:left .45s ease,top .45s ease;left:640px;top:360px';
    document.body.appendChild(c);
  }).catch(() => {});
  page.on('load', addCursor);
  async function point(loc) {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (!b) return;
    await addCursor();
    await page.evaluate(([x, y]) => { const c = document.getElementById('__cur'); if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; } }, [b.x + b.width / 2, b.y + b.height / 2]);
    await sleep(550);
  }
  async function click(loc) { await point(loc); await loc.click(); }
  async function type(text) {
    const box = page.locator('#chatInput');
    await click(box);
    await box.pressSequentially(text, { delay: 28 });
  }
  async function send(text) {
    const before = await page.locator('.msg.bot').count();
    await type(text);
    await sleep(400);
    await click(page.locator('#sendBtn'));
    await waited(() => page.waitForFunction((n) => document.querySelectorAll('.msg.bot:not(.typing)').length > n, before, { timeout: 90000 }));
    await sleep(1200);
  }
  async function waited(fn) {
    await sleep(1500);
    const a = now();
    await fn();
    const b = now() - 0.3;
    if (b - a > 1) cuts.push([a, b]);
  }
  const lastCard = () => page.locator('.card').last();

  await page.goto(APP);
  await page.waitForSelector('#kpis .kpi');
  await sleep(1500);

  scene('1 hero');
  await point(page.locator('#heroTitle'));
  await sleep(2500);
  const steps = page.locator('#demoSteps');
  if (await steps.count()) { await point(steps); await sleep(4000); } else await sleep(4000);

  scene('2 badges and how it works');
  await point(page.locator('#badges'));
  await sleep(3500);
  if (await page.locator('#flow').count()) { await point(page.locator('#flow')); await sleep(4000); }

  scene('3 ask for an invoice');
  await point(page.locator('#micBtn')); // voice input exists; headless browsers have no microphone, so we type
  await sleep(1200);
  await send(`Invoice Acme Corp ${BUYER} 45 USD for the logo work, net 7, remind them twice`);

  scene('4 approval card');
  await point(lastCard());
  const safe = lastCard().locator('.safe');
  await sleep(4000);
  await waited(() => sleep(4000)); // Gemini pacing (cut)

  scene('5 approve and send');
  await click(lastCard().getByRole('button', { name: /Approve/ }));
  const link = lastCard().getByRole('link', { name: /Open PayPal pay link/ });
  await link.waitFor({ timeout: 60000 });
  await sleep(3500);

  scene('6 client pays on PayPal');
  await point(link);
  const href = await link.getAttribute('href');
  await page.goto(href);
  await sleep(3000);
  // Close (not accept) PayPal's cookie banner so it doesn't cover the page.
  await page.getByRole('button', { name: /close/i }).last().click({ timeout: 3000 }).catch(() => {});
  await sleep(1500);
  // The PayPal button is in an iframe; checkout opens in a pop-up window (recorded as its own video).
  let btnFrame = null;
  for (let i = 0; i < 90 && !btnFrame; i++) {
    btnFrame = page.frames().find((f) => /smart\/buttons/.test(f.url()));
    if (!btnFrame) { if (i === 40) await page.reload(); await sleep(500); }
  }
  if (!btnFrame) { await page.screenshot({ path: path.join(OUT, 'fail.png') }); throw new Error('PayPal button did not load on the invoice page (see video/fail.png)'); }
  const btn = btnFrame.locator('[data-funding-source="paypal"]').first();
  await btn.waitFor({ timeout: 30000 });
  await point(btn);
  const popupP = ctx.waitForEvent('page');
  popupT0 = (Date.now() - t0) / 1000;
  await btn.click();
  popup = await popupP;
  const complete = popup.getByRole('button', { name: /Complete Purchase|Pay Now|^Pay$/ }).first();
  await complete.waitFor({ timeout: 45000 });
  await sleep(3500);
  await complete.click();
  await popup.waitForEvent('close', { timeout: 60000 }).catch(() => {});
  popupT1 = (Date.now() - t0) / 1000;
  await page.getByText(/Payment successful/i).waitFor({ timeout: 45000 });
  await sleep(3500);

  scene('7 webhook marks it paid');
  await page.goto(APP);
  await page.waitForSelector('#kpis .kpi');
  await sleep(1000);
  await point(page.locator('#kpis'));
  await page.locator('#grid').scrollIntoViewIfNeeded();
  await point(page.locator('#grid'));
  await waited(() => page.waitForFunction(() => /PAID/.test(document.querySelector('#grid')?.innerText || ''), null, { timeout: 180000 }));
  await point(page.locator('#grid .ag-row').first());
  await sleep(2500);
  await point(page.locator('#kpis'));
  await sleep(2500);
  await click(page.locator('[data-tab="audit"]'));
  await sleep(4500);
  await click(page.locator('[data-tab="invoices"]'));

  scene('8 invoice from a client email');
  await click(page.locator('#emailBtn'));
  await sleep(1200);
  await click(page.locator('#emailSample'));
  await sleep(2500);
  const cardsBefore = await page.locator('.card').count();
  await click(page.locator('#emailSubmit'));
  await waited(() => page.waitForFunction((n) => document.querySelectorAll('.card').length > n, cardsBefore, { timeout: 90000 }));
  await sleep(1000);
  await point(lastCard());
  await sleep(5000);

  scene('9 chase and remind');
  await waited(() => sleep(4000)); // Gemini free-tier pacing (cut from the video)
  await send('Who should I chase first? Draft them a friendly reminder.');
  await click(page.locator('[data-tab="insights"]'));
  await sleep(2500);
  const remindCard = lastCard();
  await point(remindCard);
  await sleep(2500);
  const remindBtn = remindCard.getByRole('button', { name: /Approve/ });
  if (await remindBtn.count()) { await click(remindBtn); await sleep(3000); }

  scene('10 autopilot');
  await waited(() => sleep(4000)); // Gemini free-tier pacing (cut from the video)
  await click(page.locator('[data-tab="autopilot"]'));
  await sleep(1500);
  await click(page.locator('#pane-autopilot .switch.big'));
  await page.waitForFunction(() => /Autopilot is ON/.test(document.querySelector('#pane-autopilot')?.innerText || ''), null, { timeout: 15000 });
  await sleep(1200);
  const invRule = page.locator('#pane-autopilot .ap-rule').first();
  if (!(await invRule.locator('input[data-ap="invoices.enabled"]').isChecked())) await click(invRule.locator('.switch'));
  await sleep(1000);
  const max = page.locator('input[data-ap-num="invoices.maxAmount"]');
  await click(max); await max.fill('200'); await max.press('Tab');
  await sleep(1000);
  const known = page.locator('input[data-ap="invoices.knownClientsOnly"]');
  if (await known.isChecked()) await click(known);
  await sleep(2500);
  await send(`Invoice Acme Corp ${BUYER} 15 USD for a favicon`);
  await point(lastCard());
  await sleep(4500);
  await waited(() => sleep(4000)); // Gemini pacing (cut)
  await send(`Invoice Acme Corp ${BUYER} 450 USD for the full rebrand`);
  await point(lastCard());
  await sleep(5000);

  scene('11 pay a contractor');
  await waited(() => sleep(4000)); // Gemini pacing (cut)
  await send(`Pay ${BUYER} 20 USD for illustration work`);
  const payCard = lastCard();
  await point(payCard);
  await sleep(2000);
  await click(payCard.getByRole('button', { name: /Approve/ }));
  await sleep(2500);
  await click(page.locator('[data-tab="payouts"]'));
  await sleep(3500);

  scene('12 briefing and matching');
  const gen = page.getByRole('button', { name: /Generate briefing/ });
  if (await gen.count()) {
    await click(gen);
    await waited(() => page.waitForFunction(() => /written by gemini/i.test(document.querySelector('#briefing')?.innerText || ''), null, { timeout: 90000 }).catch(() => {}));
  }
  // The briefing may already exist (it refreshes after a payment): always show it.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(800);
  await point(page.locator('#briefing'));
  await sleep(6000);
  await click(page.locator('[data-tab="matching"]'));
  await sleep(4000);

  scene('13 closing');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await point(page.locator('#heroTitle'));
  await sleep(6000);
  scene('end');

  const video = page.video();
  const popVideo = popup && popup.video();
  await ctx.close();
  const main = path.join(OUT, 'main.webm');
  fs.renameSync(await video.path(), main);
  if (popVideo) fs.renameSync(await popVideo.path(), path.join(OUT, 'popup.webm'));
  fs.writeFileSync(path.join(OUT, 'scenes.json'), JSON.stringify({ scenes, cuts, popup: popVideo ? { start: popupT0, end: popupT1 } : null }, null, 2));
  await browser.close();
  console.log('saved', main, popVideo ? '+ popup.webm' : '');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
