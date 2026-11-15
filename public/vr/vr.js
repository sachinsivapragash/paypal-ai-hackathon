// DuePilot Ledger Room: a WebXR (VR + passthrough MR) view of your receivables, wired to the live
// DuePilot backend (PayPal sandbox + Gemini agent). Every write still goes through DuePilot's
// approval endpoint: throwing an invoice in a bin only *proposes* an action; you approve it by
// dropping its tablet in the green slot.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const $ = (s) => document.querySelector(s);
const COLORS = { SENT: 0xffb347, OVERDUE: 0xff5c6c, PAID: 0x4cd98a, DRAFT: 0x8892b0, CANCELLED: 0x555d78 };
const RISK = { high: 0xff5c6c, medium: 0xffb347, low: 0x4cd98a };
const DAY = 86400000;

// ---------- logging ----------
function log(msg) {
  const d = document.createElement('div');
  d.textContent = `${new Date().toLocaleTimeString()} · ${msg}`;
  $('#log').prepend(d);
  agentPanel?.set(msg);
}

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const roomBg = new THREE.Color(0x0b1020);
scene.background = roomBg;
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, 2.1, 3.4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.1, -0.6);
controls.update();

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x202040, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(2, 4, 3);
scene.add(sun);

const room = new THREE.Group();
scene.add(room);
const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshStandardMaterial({ color: 0x141b36, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
room.add(floor);
const grid = new THREE.PolarGridHelper(6, 16, 12, 64, 0x2a3558, 0x1b2340);
grid.position.y = 0.001;
room.add(grid);

// ---------- canvas text panels ----------
function panel(w, h, px = 512) {
  const c = document.createElement('canvas');
  c.width = px; c.height = Math.round(px * h / w);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  const g = c.getContext('2d');
  mesh.draw = (fn) => { g.clearRect(0, 0, c.width, c.height); fn(g, c.width, c.height); tex.needsUpdate = true; };
  return mesh;
}
function wrapText(g, text, x, y, maxW, lh, maxLines = 12) {
  const words = String(text).split(/\s+/); let line = ''; let n = 0;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y + n * lh); line = w; if (++n >= maxLines) return; }
    else line = t;
  }
  if (line) g.fillText(line, x, y + n * lh);
}
function card(g, W, H, fill = '#0f1630ee') {
  g.fillStyle = fill; g.strokeStyle = '#3a4a80'; g.lineWidth = 6;
  g.beginPath(); g.roundRect(3, 3, W - 6, H - 6, 24); g.fill(); g.stroke();
}

// Agent panel (big screen behind the shelf)
const agentPanel = panel(1.6, 0.7, 1024);
agentPanel.position.set(0, 2.2, -2.2);
scene.add(agentPanel);
agentPanel.set = (msg) => agentPanel.draw((g, W, H) => {
  card(g, W, H);
  g.fillStyle = '#8fb0ff'; g.font = 'bold 34px system-ui'; g.fillText('DuePilot agent (Gemini)', 30, 56);
  g.fillStyle = '#e8ecf6'; g.font = '30px system-ui'; wrapText(g, msg, 30, 110, W - 60, 38, 9);
});
agentPanel.set('Say or type a request. Throw an invoice into a bin to propose an action.');

// Audit ticker
const auditPanel = panel(0.9, 0.9, 512);
auditPanel.position.set(-2.1, 1.5, -1.2);
auditPanel.rotation.y = Math.PI / 4;
scene.add(auditPanel);

// Cash-flow summary
const sumPanel = panel(1.0, 0.45, 512);
sumPanel.position.set(0, 2.85, -2.2);
scene.add(sumPanel);

// QR / detail panel (shows the invoice you are holding)
const detailPanel = panel(0.6, 0.75, 512);
detailPanel.position.set(1.15, 1.45, -0.9);
detailPanel.rotation.y = -Math.PI / 6;
scene.add(detailPanel);
detailPanel.draw((g, W, H) => { card(g, W, H); g.fillStyle = '#aab4d4'; g.font = '28px system-ui'; wrapText(g, 'Grab an invoice to see details and its PayPal scan-to-pay QR code.', 24, 60, W - 48, 36); });

// ---------- drop targets ----------
const targets = [];
function addTarget(kind, accepts, label, color, pos, radius = 0.22) {
  const g = new THREE.Group();
  const isBin = accepts === 'invoice';
  const geo = isBin ? new THREE.CylinderGeometry(radius, radius * 0.8, 0.45, 32, 1, true) : new THREE.CylinderGeometry(radius, radius, 0.04, 32);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  m.position.y = isBin ? 0.225 : 0.02;
  g.add(m);
  const lab = panel(0.5, 0.12, 512);
  lab.draw((c, W, H) => { c.fillStyle = '#' + color.toString(16).padStart(6, '0'); c.font = 'bold 64px system-ui'; c.textAlign = 'center'; c.fillText(label, W / 2, H * 0.72); });
  lab.position.y = isBin ? 0.6 : 0.2;
  g.add(lab);
  g.position.copy(pos);
  scene.add(g);
  targets.push({ kind, accepts, group: g, radius, top: isBin ? 0.45 : 0.06, mesh: m, label: lab });
}
addTarget('remind', 'invoice', 'Remind', COLORS.SENT, new THREE.Vector3(-0.7, 0, 0.1));
addTarget('sync', 'invoice', 'Sync PayPal', COLORS.PAID, new THREE.Vector3(0, 0, 0.35));
addTarget('cancel', 'invoice', 'Cancel', COLORS.OVERDUE, new THREE.Vector3(0.7, 0, 0.1));
// approval table on the left
const table = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.6), new THREE.MeshStandardMaterial({ color: 0x223066 }));
table.position.set(-1.3, 0.8, -0.3); table.rotation.y = Math.PI / 5;
scene.add(table);
addTarget('approve', 'pending', 'APPROVE', COLORS.PAID, new THREE.Vector3(-1.05, 0.82, 0.05), 0.16);
addTarget('reject', 'pending', 'Reject', COLORS.OVERDUE, new THREE.Vector3(-1.55, 0.82, -0.25), 0.13);
for (const t of targets) if (t.accepts === 'pending') t.group.rotation.y = Math.PI / 5;

// ---------- data ----------
let state = null; let sample = false; let status = {};
const grabbables = new Map(); // id -> mesh
let lastSig = '';
const prevStatus = new Map();

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function sampleState() {
  const now = Date.now();
  const mk = (n, clientName, amount, desc, sentAgo, net, paidAfter) => ({
    id: 'smp' + n, number: String(n), clientName, amount, currency: 'USD', description: desc,
    sentAt: new Date(now - sentAgo * DAY).toISOString(), dueDate: new Date(now - (sentAgo - net) * DAY).toISOString().slice(0, 10),
    status: paidAfter != null ? 'PAID' : (sentAgo - net > 0 ? 'OVERDUE' : 'SENT'), payLink: 'https://www.sandbox.paypal.com/invoice/p/#sample',
  });
  const invoices = [mk(2001, 'Brightline Studio', 1200, 'Brand identity', 40, 14, 9), mk(2002, 'Brightline Studio', 650, 'Social templates', 12, 14),
    mk(2003, 'Northwind Cafe', 280, 'Photo edits', 18, 7), mk(2004, 'Kestrel Labs', 2400, 'Landing page', 25, 30, 12),
    mk(2005, 'Kestrel Labs', 900, 'A/B variants', 4, 30), mk(2006, 'Orchid Events', 450, 'Poster series', 20, 7), mk(2007, 'Pine & Co', 1500, 'App icons', 2, 14)];
  return { invoices, pending: [], audit: [{ at: new Date().toISOString(), actor: 'demo', action: 'sample_room_loaded' }], insights: insightsOf(invoices), summary: summaryOf(invoices) };
}
function insightsOf(inv) {
  const by = {};
  for (const i of inv) { const c = (by[i.clientName] ||= { client: i.clientName, owed: 0, overdue: 0 }); if (i.status !== 'PAID') c.owed += i.amount; if (i.status === 'OVERDUE') c.overdue++; }
  return Object.values(by).map((c) => ({ ...c, risk: c.overdue ? 'high' : c.owed > 1000 ? 'medium' : 'low' }));
}
function summaryOf(inv) {
  const s = { paid: 0, outstanding: 0, overdue: 0, currency: 'USD' };
  for (const i of inv) { if (i.status === 'PAID') s.paid += i.amount; else if (i.status === 'OVERDUE') { s.overdue += i.amount; s.outstanding += i.amount; } else if (i.status === 'SENT') s.outstanding += i.amount; }
  return s;
}

async function refresh() {
  if (sample) return render();
  try { state = await api('/api/state'); render(); }
  catch (e) { $('#src').textContent = `Backend unreachable (${e.message}). Showing sample data.`; sample = true; state = sampleState(); render(); }
}

// ---------- building the room from state ----------
const invoiceGroup = new THREE.Group(); scene.add(invoiceGroup);
const pendingGroup = new THREE.Group(); scene.add(pendingGroup);
const orbGroup = new THREE.Group(); scene.add(orbGroup);
const fmt = (n, c = 'USD') => `${c === 'USD' ? '$' : ''}${Math.round(n).toLocaleString()}${c === 'USD' ? '' : ' ' + c}`;

function render() {
  const s = state;
  $('#src').textContent = sample ? 'Sample data (local, nothing is sent to PayPal)' : `Live: DuePilot · PayPal ${status.paypal || '?'} · AI ${status.ai || '?'}`;
  // chime + log when an invoice becomes PAID (webhook reconciled)
  for (const i of s.invoices) { const was = prevStatus.get(i.id); if (was && was !== 'PAID' && i.status === 'PAID') { chime(); log(`💰 Invoice #${i.number} from ${i.clientName} was paid`); } prevStatus.set(i.id, i.status); }
  drawSummary(s); drawAudit(s);
  const sig = JSON.stringify([s.invoices.map((i) => [i.id, i.status, i.amount]), s.pending.map((p) => p.id), s.insights?.map((c) => [c.client, c.owed, c.risk])]);
  if (sig === lastSig) return; lastSig = sig;

  for (const g of [invoiceGroup, pendingGroup, orbGroup]) for (const m of [...g.children]) if (!held.has(m)) { g.remove(m); grabbables.delete(m.userData.id); }

  // Invoices on a timeline arc: most overdue on the left, due-latest on the right.
  const open = s.invoices.filter((i) => ['SENT', 'OVERDUE', 'PAID'].includes(i.status)).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')).slice(0, 18);
  const max = Math.max(1, ...open.map((i) => i.amount));
  open.forEach((inv, k) => {
    if ([...held].some((m) => m.userData.id === inv.id)) return;
    const a = open.length === 1 ? 0 : -0.9 + 1.8 * k / (open.length - 1);
    const h = 0.08 + 0.5 * inv.amount / max;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, 0.16), new THREE.MeshStandardMaterial({ color: COLORS[inv.status] || 0x8892b0, roughness: 0.35, metalness: 0.2, emissive: inv.status === 'OVERDUE' ? 0x400010 : 0 }));
    const lab = panel(0.3, 0.2, 256);
    const days = inv.dueDate ? Math.round((new Date(inv.dueDate + 'T23:59:59Z') - Date.now()) / DAY) : null;
    lab.draw((g, W, H) => { card(g, W, H); g.fillStyle = '#fff'; g.font = 'bold 26px system-ui'; g.fillText(`#${inv.number} ${fmt(inv.amount, inv.currency)}`, 14, 40); g.font = '22px system-ui'; g.fillStyle = '#cfd6ee'; g.fillText(inv.clientName.slice(0, 18), 14, 76); g.fillStyle = inv.status === 'PAID' ? '#4cd98a' : days < 0 ? '#ff7c8a' : '#ffcf7a'; g.fillText(inv.status === 'PAID' ? 'paid' : days < 0 ? `${-days}d overdue` : `due in ${days}d`, 14, 110); });
    lab.position.set(0, h / 2 + 0.12, 0);
    mesh.add(lab);
    mesh.position.set(Math.sin(a) * 1.3, 0.75 + h / 2, -Math.cos(a) * 1.3 + 0.1);
    mesh.lookAt(0, mesh.position.y, 0.4);
    mesh.userData = { id: inv.id, kind: 'invoice', inv, home: mesh.position.clone(), homeQ: mesh.quaternion.clone(), h };
    invoiceGroup.add(mesh); grabbables.set(inv.id, mesh);
  });
  // shelf under the arc
  if (!invoiceGroup.userData.shelf) {
    const shelf = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.025, 8, 64, 1.9), new THREE.MeshStandardMaterial({ color: 0x3a4a80 }));
    shelf.rotation.set(Math.PI / 2, 0, Math.PI / 2 - 0.95 + Math.PI); shelf.position.set(0, 0.74, 0.1);
    scene.add(shelf); invoiceGroup.userData.shelf = shelf;
    const tl = panel(1.4, 0.1, 1024); tl.draw((g, W, H) => { g.fillStyle = '#7d8bbd'; g.font = '44px system-ui'; g.fillText('← due earliest / overdue', 10, 60); g.textAlign = 'right'; g.fillText('due latest →', W - 10, 60); });
    tl.position.set(0, 0.55, -1.15); scene.add(tl);
  }

  // Approval tablets on the table
  s.pending.slice(0, 6).forEach((p, k) => {
    const t = panel(0.24, 0.16, 384);
    t.material.side = THREE.DoubleSide;
    const d = p.data || {};
    t.draw((g, W, H) => { card(g, W, H, '#132046f2'); g.fillStyle = '#8fb0ff'; g.font = 'bold 26px system-ui'; g.fillText(p.type.replace(/_/g, ' '), 16, 40); g.fillStyle = '#fff'; g.font = '24px system-ui'; wrapText(g, [d.clientName || d.receiver || d.client || d.number && `#${d.number}`, d.amount && fmt(d.amount, d.currency), d.description || d.message].filter(Boolean).join(' · '), 16, 78, W - 32, 30, 4); });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.17, 0.012), new THREE.MeshStandardMaterial({ color: 0x5b8cff }));
    t.position.z = 0.007; body.add(t);
    body.position.set(-1.45 + (k % 3) * 0.27, 0.92 + Math.floor(k / 3) * 0.2, -0.55 + (k % 3) * 0.17);
    body.rotation.set(-0.5, Math.PI / 5, 0);
    body.userData = { id: p.id, kind: 'pending', p, home: body.position.clone(), homeQ: body.quaternion.clone(), h: 0.17 };
    pendingGroup.add(body); grabbables.set(p.id, body);
  });

  // Client risk orbs: size = amount owed, colour = risk
  (s.insights || []).slice(0, 8).forEach((c, k) => {
    const r = 0.04 + Math.min(0.08, Math.sqrt(c.owed || 0) / 500);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshStandardMaterial({ color: RISK[c.risk] || 0x8892b0, emissive: RISK[c.risk] || 0, emissiveIntensity: 0.35, roughness: 0.2 }));
    const lab = panel(0.36, 0.08, 256); lab.draw((g, W, H) => { g.fillStyle = '#e8ecf6'; g.font = '26px system-ui'; g.textAlign = 'center'; g.fillText(`${c.client.slice(0, 16)} ${fmt(c.owed)}`, W / 2, 40); });
    lab.position.y = r + 0.06; orb.add(lab);
    orb.position.set(1.9 + (k % 2) * 0.45, 0.9 + Math.floor(k / 2) * 0.4, -0.6 + (k % 2) * 0.3);
    orb.userData = { id: 'orb' + k, kind: 'orb', bob: k };
    orbGroup.add(orb);
  });
}
function drawSummary(s) {
  const m = s.summary || {};
  sumPanel.draw((g, W, H) => {
    card(g, W, H);
    const rows = [['Paid', m.paid, '#4cd98a'], ['Outstanding', m.outstanding, '#ffcf7a'], ['Overdue', m.overdue, '#ff7c8a']];
    const max = Math.max(1, ...rows.map((r) => r[1] || 0));
    rows.forEach(([k, v, c], i) => { const y = 50 + i * 66; g.fillStyle = '#cfd6ee'; g.font = '26px system-ui'; g.fillText(k, 20, y + 22); g.fillStyle = c; g.fillRect(170, y, 220 * (v || 0) / max, 30); g.fillStyle = '#fff'; g.fillText(fmt(v || 0, m.currency), 400, y + 24); });
  });
}
function drawAudit(s) {
  auditPanel.draw((g, W, H) => {
    card(g, W, H); g.fillStyle = '#8fb0ff'; g.font = 'bold 30px system-ui'; g.fillText('Audit log', 20, 46);
    g.font = '20px system-ui';
    (s.audit || []).slice(0, 14).forEach((a, i) => { g.fillStyle = i ? '#aab4d4' : '#fff'; g.fillText(`${(a.at || '').slice(11, 19)} ${a.actor || ''}: ${String(a.action || '').replace(/_/g, ' ')}`.slice(0, 40), 20, 84 + i * 29); });
  });
}

// ---------- actions (bins / slots) ----------
async function act(target, obj) {
  const u = obj.userData;
  buzz(0.8, 60);
  try {
    if (sample) return sampleAct(target.kind, u);
    if (target.kind === 'approve') { log(`Approving ${u.p.type.replace(/_/g, ' ')}… (PayPal sandbox)`); const r = await api(`/api/actions/${u.id}/approve`, {}); state = r.state; chime(); log(`✅ Done${r.result?.number ? `: invoice #${r.result.number}` : ''}${r.result?.payLink ? ' · pay link ready' : ''}`); }
    else if (target.kind === 'reject') { const r = await api(`/api/actions/${u.id}/reject`, {}); state = r.state || state; log('Rejected. Nothing was sent to PayPal.'); }
    else if (target.kind === 'sync') { log(`Syncing #${u.inv.number} with PayPal…`); const r = await api(`/api/invoices/${u.id}/sync`, {}); state = r.state || state; const now = r.state?.invoices?.find((i) => i.id === u.id); log(`#${u.inv.number} is ${now?.status || 'up to date'} on PayPal`); }
    else if (target.kind === 'remind') await chat(`Send a reminder for invoice #${u.inv.number}`);
    else if (target.kind === 'cancel') await chat(`Cancel invoice #${u.inv.number}`);
  } catch (e) { log(`⚠️ ${e.message}`); }
  lastSig = ''; refresh();
}
function sampleAct(kind, u) {
  if (kind === 'remind' || kind === 'cancel') {
    state.pending.unshift({ id: 'sp' + Date.now(), type: kind === 'remind' ? 'send_reminder' : 'cancel_invoice', data: { number: u.inv.number, clientName: u.inv.clientName, amount: u.inv.amount, currency: u.inv.currency, invoiceId: u.id } });
    log(`Proposed: ${kind} #${u.inv.number}. Drop the tablet in APPROVE to confirm.`);
  } else if (kind === 'sync') log(`#${u.inv.number}: ${u.inv.status} (sample)`);
  else if (kind === 'approve' || kind === 'reject') {
    state.pending = state.pending.filter((p) => p.id !== u.id);
    if (kind === 'approve') {
      const inv = state.invoices.find((i) => i.id === u.p.data.invoiceId);
      if (inv && u.p.type === 'cancel_invoice') inv.status = 'CANCELLED';
      log(`✅ Approved ${u.p.type.replace(/_/g, ' ')} (sample, nothing sent)`); chime();
    } else log('Rejected.');
    state.audit.unshift({ at: new Date().toISOString(), actor: 'user', action: `${kind}_${u.p.type}` });
  }
  state.summary = summaryOf(state.invoices); state.insights = insightsOf(state.invoices);
  lastSig = ''; render();
}
async function chat(message) {
  log(`🗣 ${message}`);
  if (sample) { log('Sample mode: connect the live DuePilot backend to talk to Gemini.'); return; }
  const r = await api('/api/chat', { message });
  state = r.state; speak(r.reply); log(r.reply);
  if (r.proposals?.length) log(`${r.proposals.length} approval tablet(s) are on the table. Drop one in APPROVE to send it to PayPal.`);
  lastSig = ''; render();
}

// ---------- detail / QR for a held invoice ----------
async function showDetail(u) {
  if (u.kind === 'pending') return detailPanel.draw((g, W, H) => { card(g, W, H); g.fillStyle = '#8fb0ff'; g.font = 'bold 30px system-ui'; g.fillText('Approval needed', 24, 50); g.fillStyle = '#fff'; g.font = '24px system-ui'; wrapText(g, JSON.stringify(u.p.data).replace(/[{}"]/g, ' ').slice(0, 400), 24, 96, W - 48, 30, 16); });
  const i = u.inv;
  let img = null;
  if (!sample && ['SENT', 'OVERDUE'].includes(i.status)) {
    try { const q = await api(`/api/invoices/${i.id}/qr`); if (q.png) { img = new Image(); img.src = 'data:image/png;base64,' + q.png; await img.decode(); } } catch { /* demo mode has no QR */ }
  }
  detailPanel.draw((g, W, H) => {
    card(g, W, H); g.fillStyle = '#fff'; g.font = 'bold 32px system-ui'; g.fillText(`Invoice #${i.number}`, 24, 50);
    g.font = '26px system-ui'; g.fillStyle = '#cfd6ee';
    [i.clientName, `${fmt(i.amount, i.currency)} · ${i.status}`, `Due ${i.dueDate || '-'}`, i.description || ''].forEach((t, k) => g.fillText(String(t).slice(0, 30), 24, 92 + k * 34));
    if (img) g.drawImage(img, (W - 300) / 2, 240, 300, 300);
    else { g.fillStyle = '#7d8bbd'; g.font = '22px system-ui'; wrapText(g, i.status === 'PAID' ? 'Paid. Nothing to collect.' : 'Scan-to-pay QR appears here for live PayPal sandbox invoices.', 24, 280, W - 48, 30); }
  });
}

// ---------- grabbing (XR controllers, hands, mouse) ----------
const held = new Set();
const flying = []; // released objects in flight
const raycaster = new THREE.Raycaster();
const tmpM = new THREE.Matrix4();

function hitTest(origin, dir) {
  raycaster.set(origin, dir); raycaster.far = 12;
  const objs = [...grabbables.values()].filter((m) => !held.has(m));
  const hit = raycaster.intersectObjects(objs, true)[0];
  if (!hit) return null;
  let o = hit.object; while (o && !o.userData.kind) o = o.parent;
  return o;
}
function grab(obj, holder) {
  held.add(obj); holder.attach(obj);
  const f = flying.findIndex((x) => x.obj === obj); if (f >= 0) flying.splice(f, 1);
  showDetail(obj.userData); buzz(0.4, 30);
}
function release(obj, velocity) {
  held.delete(obj); scene.attach(obj);
  flying.push({ obj, vel: velocity.clone(), t: 0 });
}

const controllerModels = new XRControllerModelFactory();
const handModels = new XRHandModelFactory();
const xrInputs = [];
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x8fb0ff }));
  line.scale.z = 2; c.add(line);
  const st = { c, obj: null, hist: [], gamepad: null };
  c.addEventListener('connected', (e) => { st.gamepad = e.data.gamepad; });
  c.addEventListener('selectstart', () => {
    tmpM.identity().extractRotation(c.matrixWorld);
    const o = hitTest(new THREE.Vector3().setFromMatrixPosition(c.matrixWorld), new THREE.Vector3(0, 0, -1).applyMatrix4(tmpM));
    if (o) { st.obj = o; st.hist = []; grab(o, c); return; }
    if (micOrb && hitTestOrb(c)) toggleMic();
  });
  c.addEventListener('selectend', () => { if (st.obj) { release(st.obj, velocityOf(st.hist)); st.obj = null; } });
  scene.add(c);
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(controllerModels.createControllerModel(grip)); scene.add(grip);
  const hand = renderer.xr.getHand(i);
  hand.add(handModels.createHandModel(hand, 'mesh')); scene.add(hand);
  xrInputs.push(st);
}
function hitTestOrb(c) {
  tmpM.identity().extractRotation(c.matrixWorld);
  raycaster.set(new THREE.Vector3().setFromMatrixPosition(c.matrixWorld), new THREE.Vector3(0, 0, -1).applyMatrix4(tmpM));
  return raycaster.intersectObject(micOrb).length > 0;
}
function velocityOf(hist) {
  if (hist.length < 2) return new THREE.Vector3();
  const a = hist[0], b = hist[hist.length - 1]; const dt = Math.max(0.016, b.t - a.t);
  return b.p.clone().sub(a.p).divideScalar(dt).clampLength(0, 6);
}
function buzz(intensity, ms) {
  for (const s of xrInputs) s.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, ms);
}

// Mouse / touch dragging on desktop and phones
const mouse = { obj: null, plane: new THREE.Plane(), hist: [], holder: new THREE.Object3D() };
scene.add(mouse.holder);
const ndc = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (micOrb && raycaster.intersectObject(micOrb).length) { e.stopImmediatePropagation(); return toggleMic(); }
  const o = hitTest(raycaster.ray.origin, raycaster.ray.direction);
  if (!o) return;
  e.stopImmediatePropagation(); // keep OrbitControls from rotating while we drag
  controls.enabled = false;
  const wp = o.getWorldPosition(new THREE.Vector3());
  mouse.plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), wp);
  mouse.holder.position.copy(wp); mouse.holder.quaternion.identity(); mouse.holder.updateMatrixWorld();
  mouse.obj = o; mouse.hist = []; grab(o, mouse.holder);
}, { capture: true });
addEventListener('pointermove', (e) => {
  if (!mouse.obj) return;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const p = new THREE.Vector3(); if (raycaster.ray.intersectPlane(mouse.plane, p)) mouse.holder.position.copy(p);
});
addEventListener('pointerup', (e) => {
  if (!mouse.obj) return;
  // Desktop: releasing the pointer over a bin/slot drops the object into it.
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera); raycaster.far = 20;
  const tgt = targets.find((t) => t.accepts === mouse.obj.userData.kind && raycaster.intersectObjects([t.mesh, t.label]).length);
  if (tgt) { const o = mouse.obj; held.delete(o); scene.attach(o); o.visible = false; mouse.obj = null; controls.enabled = true; pulseTarget(tgt); act(tgt, o); return; }
  release(mouse.obj, velocityOf(mouse.hist).multiplyScalar(0.6)); mouse.obj = null; controls.enabled = true;
});

// ---------- physics for thrown objects ----------
function stepFlying(dt) {
  for (let k = flying.length - 1; k >= 0; k--) {
    const f = flying[k]; const o = f.obj; f.t += dt;
    f.vel.y -= 9.8 * dt; f.vel.multiplyScalar(0.995);
    o.position.addScaledVector(f.vel, dt);
    for (const t of targets) {
      if (t.accepts !== o.userData.kind) continue;
      const c = t.group.position; const dx = o.position.x - c.x, dz = o.position.z - c.z;
      if (dx * dx + dz * dz < (t.radius + 0.05) ** 2 && o.position.y < c.y + t.top + 0.15) {
        flying.splice(k, 1); pulseTarget(t); o.visible = false; act(t, o); break;
      }
    }
    if (!flying.includes(f)) continue;
    const floorY = o.userData.h / 2;
    if (o.position.y <= floorY || f.t > 1.2) { // missed: float back home
      flying.splice(k, 1); homing.push({ o, t: 0, from: o.position.clone(), fq: o.quaternion.clone() });
    }
  }
  for (let k = homing.length - 1; k >= 0; k--) {
    const h = homing[k]; h.t = Math.min(1, h.t + dt * 1.8); const e = 1 - (1 - h.t) ** 3;
    h.o.position.lerpVectors(h.from, h.o.userData.home, e); h.o.quaternion.slerpQuaternions(h.fq, h.o.userData.homeQ, e);
    if (h.t >= 1) homing.splice(k, 1);
  }
}
const homing = [];
const pulses = [];
function pulseTarget(t) { pulses.push({ t, life: 0.5 }); }

// ---------- audio ----------
let audio;
function chime() {
  try {
    audio ||= new AudioContext();
    [880, 1320].forEach((f, i) => { const o = audio.createOscillator(); const g = audio.createGain(); o.frequency.value = f; o.type = 'triangle'; g.gain.setValueAtTime(0.0001, audio.currentTime + i * 0.09); g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + i * 0.09 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + i * 0.09 + 0.5); o.connect(g).connect(audio.destination); o.start(audio.currentTime + i * 0.09); o.stop(audio.currentTime + i * 0.09 + 0.6); });
  } catch { /* audio blocked until user gesture */ }
}
function speak(text) {
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(String(text).replace(/[*_#⚡✅]/g, '').slice(0, 400)); u.rate = 1.05; speechSynthesis.speak(u); } catch { /* no TTS */ }
}

// ---------- voice: Web Speech -> Gemini agent ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false;
const micOrb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), new THREE.MeshStandardMaterial({ color: 0x5b8cff, emissive: 0x2244aa, emissiveIntensity: 0.6 }));
micOrb.position.set(0.55, 1.15, -0.25);
scene.add(micOrb);
const micLab = panel(0.3, 0.07, 256); micLab.draw((g, W) => { g.fillStyle = '#cfd6ee'; g.font = '28px system-ui'; g.textAlign = 'center'; g.fillText('🎙 talk to agent', W / 2, 40); });
micLab.position.y = 0.11; micOrb.add(micLab);
function toggleMic() {
  if (!SR) return log('Voice input is not supported in this browser. Type in the box instead.');
  if (listening) { rec?.stop(); return; }
  rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false;
  rec.onresult = (e) => { const t = e.results[0][0].transcript; $('#say').value = t; chat(t).catch((err) => log(`⚠️ ${err.message}`)); };
  rec.onend = () => { listening = false; micOrb.material.emissive.setHex(0x2244aa); };
  rec.onerror = (e) => log(`Mic: ${e.error}`);
  rec.start(); listening = true; micOrb.material.emissive.setHex(0xff3355); log('Listening…');
}

// ---------- HTML controls ----------
$('#mic').onclick = toggleMic;
const sendTyped = () => { const t = $('#say').value.trim(); if (t) { $('#say').value = ''; chat(t).catch((e) => log(`⚠️ ${e.message}`)); } };
$('#send').onclick = sendTyped;
$('#say').onkeydown = (e) => { if (e.key === 'Enter') sendTyped(); };
$('#brief').onclick = async () => {
  if (sample) { const s = state.summary; const t = `Sample briefing: ${fmt(s.outstanding)} outstanding, ${fmt(s.overdue)} overdue. Chase the red blocks first.`; log(t); return speak(t); }
  try { log('Writing your weekly briefing…'); const r = await api('/api/briefing', {}); state = r.state; log(r.briefing.text); speak(r.briefing.text); } catch (e) { log(`⚠️ ${e.message}`); }
};
$('#match').onclick = async () => {
  if (sample) return log('Payment matching uses PayPal Transaction Search; it needs the live backend.');
  try { log('Searching PayPal transactions…'); const r = await api('/api/reconcile', {}); state = r.state; lastSig = ''; render(); log(`Scanned ${r.scanned} transactions: ${r.suggestions.length} match(es) are now approval tablets.`); } catch (e) { log(`⚠️ ${e.message}`); }
};
$('#sample').onclick = () => { sample = !sample; $('#sample').textContent = sample ? 'Live data' : 'Sample data'; lastSig = ''; if (sample) { state = sampleState(); render(); } else refresh(); };

// ---------- XR entry buttons (VR and passthrough MR) ----------
const vrBtn = VRButton.createButton(renderer, { optionalFeatures: ['local-floor', 'hand-tracking'] });
const arBtn = ARButton.createButton(renderer, { optionalFeatures: ['local-floor', 'hand-tracking'] });
vrBtn.style.bottom = arBtn.style.bottom = '80px';
vrBtn.style.left = 'calc(50% - 150px)'; arBtn.style.left = 'calc(50% + 10px)';
vrBtn.style.width = arBtn.style.width = '140px';
document.body.append(vrBtn, arBtn);
renderer.xr.addEventListener('sessionstart', () => {
  const ar = renderer.xr.getSession().environmentBlendMode !== 'opaque';
  room.visible = !ar; scene.background = ar ? null : roomBg; // MR: your real desk becomes the room
  log(ar ? 'Mixed reality: your receivables are floating in your room.' : 'VR session started.');
});
renderer.xr.addEventListener('sessionend', () => { room.visible = true; scene.background = roomBg; });

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta()); const t = clock.elapsedTime;
  for (const s of xrInputs) if (s.obj) { s.hist.push({ p: s.obj.getWorldPosition(new THREE.Vector3()), t }); if (s.hist.length > 6) s.hist.shift(); }
  if (mouse.obj) { mouse.hist.push({ p: mouse.holder.position.clone(), t }); if (mouse.hist.length > 6) mouse.hist.shift(); }
  stepFlying(dt);
  for (let k = pulses.length - 1; k >= 0; k--) { const p = pulses[k]; p.life -= dt; p.t.mesh.material.emissiveIntensity = 0.25 + 2 * Math.max(0, p.life); if (p.life <= 0) pulses.splice(k, 1); }
  for (const m of invoiceGroup.children) if (m.userData.inv?.status === 'OVERDUE' && !held.has(m)) m.material.emissiveIntensity = 0.6 + 0.4 * Math.sin(t * 4);
  for (const o of orbGroup.children) o.position.y += Math.sin(t * 1.5 + o.userData.bob) * 0.0008;
  micOrb.scale.setScalar(listening ? 1 + 0.15 * Math.sin(t * 10) : 1);
  for (const lab of targets.map((x) => x.label)) lab.quaternion.copy(camera.quaternion);
  renderer.render(scene, camera);
});

// ---------- boot ----------
(async () => {
  try { status = await api('/api/status'); } catch { /* handled in refresh */ }
  await refresh();
  if (!sample && !state.invoices.length) log('No invoices yet. Ask the agent below, e.g. “Invoice Acme ap@acme.com 300 USD for logo work”, or press Sample data.');
  setInterval(refresh, 6000);
})();
