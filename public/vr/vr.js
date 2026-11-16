// Tallyspace: a WebXR (VR + passthrough MR) view of your receivables, wired to the live
// Tallyspace backend (PayPal sandbox + Gemini agent). Every write still goes through the backend's
// approval endpoint: throwing an invoice in a bin only *proposes* an action; you approve it by
// dropping its tablet in the green slot.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ?emulate loads Meta's open-source WebXR emulator (IWER) as a Quest 3 with hand tracking, for testing and
// recording on a computer. It is never loaded otherwise.
if (new URLSearchParams(location.search).has('emulate')) {
  const { XRDevice, metaQuest3 } = await import('https://cdn.jsdelivr.net/npm/iwer@2.7.0/+esm');
  const dev = new XRDevice(metaQuest3, { stereoEnabled: false });
  dev.primaryInputMode = 'hand';
  dev.installRuntime({ forceInstall: true });
  window.xrdev = dev;
}

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
const wide = innerWidth / innerHeight > 1.4; // landscape screens: stand closer so the room fills the frame
camera.position.set(0, wide ? 1.9 : 2.0, wide ? 1.9 : 2.3);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, wide ? 1.1 : 1.2, wide ? -0.85 : -0.8);
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
{ // starfield (hidden in passthrough MR with the rest of the room)
  const n = 1800, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(18 + Math.random() * 22); v.y = Math.abs(v.y) * 0.9 - 2; pos.set([v.x, v.y, v.z], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  room.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fb6ff, size: 0.06, sizeAttenuation: true })));
}
const neon = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.012, 8, 128), new THREE.MeshBasicMaterial({ color: 0x3d7bff }));
neon.rotation.x = -Math.PI / 2; neon.position.y = 0.01; room.add(neon);
const alarmLight = new THREE.PointLight(0xff2244, 0, 4); alarmLight.position.set(0, 1.6, -1.2); scene.add(alarmLight);

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
agentPanel.position.set(0, 1.85, -2.0);
scene.add(agentPanel);
agentPanel.set = (msg) => agentPanel.draw((g, W, H) => {
  card(g, W, H);
  g.fillStyle = '#8fb0ff'; g.font = 'bold 34px system-ui'; g.fillText('Tallyspace assistant', 30, 56);
  g.fillStyle = '#e8ecf6'; g.font = '30px system-ui'; wrapText(g, msg, 30, 110, W - 60, 38, 9);
});
agentPanel.set('Say or type a request. Throw an invoice into a bin to propose an action.');

// Audit ticker
const auditPanel = panel(0.9, 0.9, 512);
auditPanel.position.set(1.8, 1.6, -0.7);
auditPanel.rotation.y = -Math.PI / 2.8;
scene.add(auditPanel);

// Cash-flow summary
const sumPanel = panel(1.0, 0.45, 512);
sumPanel.position.set(0, 2.45, -2.0);
scene.add(sumPanel);

// QR / detail panel (shows the invoice you are holding)
const detailPanel = panel(0.6, 0.75, 512);
detailPanel.position.set(0.8, 1.4, -0.55);
detailPanel.rotation.y = -Math.PI / 4.5;
scene.add(detailPanel); detailPanel.visible = false;
detailPanel.draw((g, W, H) => { card(g, W, H); g.fillStyle = '#aab4d4'; g.font = '28px system-ui'; wrapText(g, 'Grab an invoice to see details and its scan-to-pay QR code.', 24, 60, W - 48, 36); });

// ---------- drop targets ----------
const targets = [];
function addTarget(kind, accepts, label, color, pos, radius = 0.22) {
  const g = new THREE.Group();
  const isBin = accepts === 'invoice';
  const geo = isBin ? new THREE.CylinderGeometry(radius, radius * 0.8, 0.45, 32, 1, true) : new THREE.CylinderGeometry(radius, radius, 0.04, 32);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  m.position.y = isBin ? 0.225 : 0.02;
  g.add(m);
  const lab = panel(isBin ? 0.5 : 0.3, isBin ? 0.12 : 0.072, 512);
  lab.draw((c, W, H) => { c.fillStyle = '#' + color.toString(16).padStart(6, '0'); c.font = 'bold 64px system-ui'; c.textAlign = 'center'; c.fillText(label, W / 2, H * 0.72); });
  lab.position.y = isBin ? 0.6 : 0.09;
  g.add(lab);
  g.position.copy(pos);
  scene.add(g);
  targets.push({ kind, accepts, group: g, radius, top: isBin ? 0.45 : 0.06, mesh: m, label: lab });
}
addTarget('remind', 'invoice', 'Remind', COLORS.SENT, new THREE.Vector3(-0.5, 0, -0.55), 0.17);
addTarget('sync', 'invoice', 'Sync status', COLORS.PAID, new THREE.Vector3(0, 0, -0.45), 0.17);
addTarget('cancel', 'invoice', 'Cancel', COLORS.OVERDUE, new THREE.Vector3(0.5, 0, -0.55), 0.17);
// approval table on the left
const table = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.6), new THREE.MeshStandardMaterial({ color: 0x223066 }));
table.position.set(-0.85, 0.78, -0.35); table.rotation.y = Math.PI / 5;
scene.add(table); table.updateMatrixWorld();
const onTable = (x, z) => table.localToWorld(new THREE.Vector3(x, 0.02, z));
addTarget('approve', 'pending', 'APPROVE', COLORS.PAID, onTable(0.3, 0.17), 0.11);
addTarget('reject', 'pending', 'Reject', COLORS.OVERDUE, onTable(0.3, -0.19), 0.09);
for (const t of targets) if (t.accepts === 'pending') t.group.rotation.y = Math.PI / 5;

// ---------- data ----------
let state = null; let sample = false; let status = {}; let backendOk = false; let sampleWhy = '';
const grabbables = new Map(); // id -> mesh
let lastSig = '';
let roseOnce = false;
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
  if (typeof paused !== 'undefined' && paused) return;
  if (sample) return render();
  try { state = await api('/api/state'); backendOk = true; render(); }
  catch (e) { backendOk = false; setSample(true, 'backend unreachable'); }
}

// ---------- building the room from state ----------
const invoiceGroup = new THREE.Group(); scene.add(invoiceGroup);
const pendingGroup = new THREE.Group(); scene.add(pendingGroup);
const orbGroup = new THREE.Group(); scene.add(orbGroup);
const fmt = (n, c = 'USD') => `${c === 'USD' ? '$' : ''}${Math.round(n).toLocaleString()}${c === 'USD' ? '' : ' ' + c}`;

function render() {
  const s = state;
  $('#src').textContent = sample ? `Sample data${sampleWhy ? ' · ' + sampleWhy : ''} (nothing is sent anywhere)` : `Live · payments ${status.paypal || '?'} · AI ${status.ai || '?'}`;
  // chime + log when an invoice becomes PAID (webhook reconciled)
  for (const i of s.invoices) { const was = prevStatus.get(i.id); if (was && was !== 'PAID' && i.status === 'PAID') { chime(); const m = grabbables.get(i.id); coinBurst(m ? m.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.2, -1)); log(`💰 Invoice #${i.number} from ${i.clientName} was paid`); } prevStatus.set(i.id, i.status); }
  drawSummary(s); drawAudit(s); drawForecast(s);
  const sig = JSON.stringify([s.invoices.map((i) => [i.id, i.status, i.amount]), s.pending.map((p) => p.id), s.insights?.map((c) => [c.client, c.owed, c.risk])]);
  if (sig === lastSig) return; lastSig = sig;

  for (const g of [invoiceGroup, pendingGroup, orbGroup]) for (const m of [...g.children]) if (!held.has(m)) { g.remove(m); grabbables.delete(m.userData.id); }
  // thrown objects are re-parented to the scene, so clear those too (otherwise a miss leaves a ghost copy)
  for (const [id, m] of [...grabbables]) if (!held.has(m)) { m.removeFromParent(); grabbables.delete(id); }
  for (const arr of [flying, homing]) for (let k = arr.length - 1; k >= 0; k--) if (!(arr[k].obj || arr[k].o).parent) arr.splice(k, 1);

  // Invoices on a timeline arc: most overdue on the left, due-latest on the right.
  const open = s.invoices.filter((i) => ['SENT', 'OVERDUE', 'PAID'].includes(i.status)).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')).slice(0, 18);
  const max = Math.max(1, ...open.map((i) => i.amount));
  const introRise = !roseOnce && open.length > 0; if (introRise) roseOnce = true;
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
    if (inv.status === 'OVERDUE') {
      for (let r = 0; r < 2; r++) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.135, 48), new THREE.MeshBasicMaterial({ color: 0xff2244, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = -h / 2 + 0.005; ring.userData.alarm = r * 0.5; ring.raycast = () => {}; mesh.add(ring);
      }
    }
    if (introRise) { mesh.position.y -= 1.4; homing.push({ o: mesh, t: -0.6 - k * 0.12, from: mesh.position.clone(), fq: mesh.quaternion.clone() }); }
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
  s.pending.slice(0, 4).forEach((p, k) => {
    const t = panel(0.24, 0.16, 384);
    t.material.side = THREE.DoubleSide;
    const d = p.data || {};
    t.draw((g, W, H) => { card(g, W, H, '#132046f2'); g.fillStyle = '#8fb0ff'; g.font = 'bold 26px system-ui'; g.fillText(p.type.replace(/_/g, ' '), 16, 40); g.fillStyle = '#fff'; g.font = '24px system-ui'; wrapText(g, [d.clientName || d.receiver || d.client || d.number && `#${d.number}`, d.amount && fmt(d.amount, d.currency), d.description || d.message].filter(Boolean).join(' · '), 16, 78, W - 32, 30, 4); });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.17, 0.012), new THREE.MeshStandardMaterial({ color: 0x5b8cff }));
    t.position.z = 0.007; body.add(t);
    body.position.copy(onTable(-0.3 + (k % 2) * 0.27, -0.12 + Math.floor(k / 2) * 0.15)).add(new THREE.Vector3(0, 0.1, 0));
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
    orb.position.set(1.45 + (k % 2) * 0.3, 0.9 + Math.floor(k / 2) * 0.3, -1.45 + (k % 2) * 0.3);
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
  bumpCombo(u); quest(target.kind); hideDetailSoon();
  obj.removeFromParent(); if (grabbables.get(u.id) === obj) grabbables.delete(u.id);
  buzz(0.8, 60);
  try {
    if (sample) return sampleAct(target.kind, u);
    if (target.kind === 'approve') { log(`Approving ${u.p.type.replace(/_/g, ' ')}… (sandbox)`); const r = await api(`/api/actions/${u.id}/approve`, {}); state = r.state; chime(); coinBurst(target.group.position.clone().add(new THREE.Vector3(0, 0.1, 0))); log(`✅ Done${r.result?.number ? `: invoice #${r.result.number}` : ''}${r.result?.payLink ? ' · pay link ready' : ''}`); }
    else if (target.kind === 'reject') { const r = await api(`/api/actions/${u.id}/reject`, {}); state = r.state || state; log('Rejected. Nothing was sent.'); }
    else if (target.kind === 'sync') { log(`Syncing #${u.inv.number}…`); const r = await api(`/api/invoices/${u.id}/sync`, {}); state = r.state || state; const now = r.state?.invoices?.find((i) => i.id === u.id); log(`#${u.inv.number} is ${now?.status || 'up to date'}`); }
    else if (target.kind === 'remind') await chat(`Send a reminder for invoice #${u.inv.number}`);
    else if (target.kind === 'cancel') await chat(`Cancel invoice #${u.inv.number}`);
  } catch (e) { log(`⚠️ ${e.message}`); }
  lastSig = ''; refresh();
}
function sampleAct(kind, u) {
  if (kind === 'remind' || kind === 'cancel') {
    const type = kind === 'remind' ? 'send_reminder' : 'cancel_invoice';
    if (state.pending.some((p) => p.type === type && p.data.invoiceId === u.id)) { log(`#${u.inv.number} already has that proposal waiting on the table.`); lastSig = ''; return render(); }
    state.pending.unshift({ id: 'sp' + Date.now(), type: kind === 'remind' ? 'send_reminder' : 'cancel_invoice', data: { number: u.inv.number, clientName: u.inv.clientName, amount: u.inv.amount, currency: u.inv.currency, invoiceId: u.id } });
    log(`Proposed: ${kind} #${u.inv.number}. Drop the tablet in APPROVE to confirm.`);
  } else if (kind === 'sync') log(`#${u.inv.number}: ${u.inv.status} (sample)`);
  else if (kind === 'approve' || kind === 'reject') {
    state.pending = state.pending.filter((p) => p.id !== u.id);
    if (kind === 'approve') {
      const inv = state.invoices.find((i) => i.id === u.p.data.invoiceId);
      if (inv && u.p.type === 'cancel_invoice') inv.status = 'CANCELLED';
      log(`✅ Approved ${u.p.type.replace(/_/g, ' ')} (sample, nothing sent)`); chime(); coinBurst(targets.find((t) => t.kind === 'approve').group.position.clone().add(new THREE.Vector3(0, 0.1, 0)));
    } else log('Rejected.');
    state.audit.unshift({ at: new Date().toISOString(), actor: 'user', action: `${kind}_${u.p.type}` });
  }
  state.summary = summaryOf(state.invoices); state.insights = insightsOf(state.invoices);
  lastSig = ''; render();
}
async function chat(message) {
  log(`🗣 ${message}`);
  quest('chat');
  const wasSample = sample;
  if (sample && !backendOk) { log('Offline sample mode: the agent needs the live backend.'); return; }
  const r = await api('/api/chat', { message });
  const reply = String(r.reply || '').replace(/\*\*/g, '');
  speak(reply);
  if (wasSample && !r.state.invoices.length && !r.state.pending.length) { log(`${reply} (That answer is about your live account, which is empty. The room is showing sample data.)`); return; }
  log(reply);
  if (wasSample) { sample = false; sampleWhy = ''; $('#sample').textContent = 'Sample data'; syncSampleLabel(); log('Switched to live data.'); }
  state = r.state;
  if (r.proposals?.length) log(`${r.proposals.length} approval tablet(s) are on the table. Drop one in APPROVE to run it.`);
  lastSig = ''; render();
}

// ---------- detail / QR for a held invoice ----------
async function showDetail(u) {
  detailPanel.visible = true;
  if (u.kind === 'pending') return detailPanel.draw((g, W, H) => { card(g, W, H); g.fillStyle = '#8fb0ff'; g.font = 'bold 30px system-ui'; g.fillText('Approval needed', 24, 50); g.fillStyle = '#fff'; g.font = '24px system-ui'; const d = u.p.data || {}; const rows = [['Action', u.p.type.replace(/_/g, ' ')], ['Client', d.clientName || d.client || d.receiver], ['Invoice', d.number && '#' + d.number], ['Amount', d.amount && fmt(d.amount, d.currency)], ['For', d.description], ['Message', d.message]].filter((r) => r[1]);
    rows.forEach(([k, v], n) => { g.fillStyle = '#7d8bbd'; g.fillText(k, 24, 100 + n * 44); g.fillStyle = '#fff'; g.fillText(String(v).slice(0, 26), 150, 100 + n * 44); });
    g.fillStyle = '#4cd98a'; g.font = '22px system-ui'; wrapText(g, 'Drop in APPROVE to run it, or in Reject to discard.', 24, H - 70, W - 48, 28, 2); });
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
    else { g.fillStyle = '#7d8bbd'; g.font = '22px system-ui'; wrapText(g, i.status === 'PAID' ? 'Paid. Nothing to collect.' : 'Scan-to-pay QR appears here for live invoices.', 24, 280, W - 48, 30); }
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
  const b = raycaster.intersectObjects(clickables.filter((x) => x.visible))[0];
  if (b && b.distance < hit.distance) return null; // a button in front of the object wins
  let o = hit.object; while (o && !o.userData.kind) o = o.parent;
  return o;
}
function grab(obj, holder) {
  held.add(obj); holder.attach(obj);
  const f = flying.findIndex((x) => x.obj === obj); if (f >= 0) flying.splice(f, 1);
  showDetail(obj.userData); buzz(0.4, 30);
  if (obj.userData.kind === 'invoice') quest('grab');
}
let detailTimer;
function hideDetailSoon() { clearTimeout(detailTimer); detailTimer = setTimeout(() => { if (!held.size) detailPanel.visible = false; }, 3500); }
function release(obj, velocity) {
  hideDetailSoon();
  if (velocity.length() > 1.2) whoosh(Math.min(1, velocity.length() / 5));
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
    if (mr.placing && mr.reticle.visible) return placeLedger();
    const origin = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld), dir = new THREE.Vector3(0, 0, -1).applyMatrix4(tmpM);
    const o = hitTest(origin, dir);
    if (o) { st.obj = o; st.hist = []; grab(o, c); return; }
    if (micOrb && hitTestOrb(c)) return toggleMic();
    raycaster.set(origin, dir); raycaster.far = 12;
    const b = raycaster.intersectObjects(clickables.filter((x) => x.visible))[0]; if (b) pressButton(b.object);
  });
  c.addEventListener('selectend', () => {
    if (!st.obj) return;
    const o = st.obj; st.obj = null;
    // Seated / hands-first: no need to throw. Point at a bin or pad and let go (pinch release).
    tmpM.identity().extractRotation(c.matrixWorld);
    raycaster.set(new THREE.Vector3().setFromMatrixPosition(c.matrixWorld), new THREE.Vector3(0, 0, -1).applyMatrix4(tmpM)); raycaster.far = 12;
    const tgt = targets.find((t) => t.accepts === o.userData.kind && raycaster.intersectObjects([t.mesh, t.label]).length);
    if (tgt) { held.delete(o); scene.attach(o); o.visible = false; pulseTarget(tgt); impact(tgt); act(tgt, o); return; }
    release(o, velocityOf(st.hist));
  });
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
  if (!o) { raycaster.far = 12; const b = raycaster.intersectObjects(clickables.filter((x) => x.visible))[0]; if (b) { e.stopImmediatePropagation(); pressButton(b.object); } return; }
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
  let tgt = targets.find((t) => t.accepts === mouse.obj.userData.kind && raycaster.intersectObjects([t.mesh, t.label]).length);
  if (!tgt) { // forgiving drop: releasing within ~70px of a matching bin or pad counts
    let best = 70;
    for (const t of targets) if (t.accepts === mouse.obj.userData.kind) {
      const v = t.mesh.getWorldPosition(new THREE.Vector3()).project(camera);
      const d = Math.hypot((v.x + 1) / 2 * innerWidth - e.clientX, (1 - v.y) / 2 * innerHeight - e.clientY);
      if (d < best) { best = d; tgt = t; }
    }
  }
  if (tgt) { const o = mouse.obj; held.delete(o); scene.attach(o); o.visible = false; mouse.obj = null; controls.enabled = true; pulseTarget(tgt); impact(tgt); act(tgt, o); return; }
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
        flying.splice(k, 1); pulseTarget(t); impact(t); o.visible = false; act(t, o); break;
      }
    }
    if (!flying.includes(f)) continue;
    const floorY = o.userData.h / 2;
    if (o.position.y <= floorY || f.t > 1.2) { // missed: float back home
      flying.splice(k, 1); homing.push({ o, t: 0, from: o.position.clone(), fq: o.quaternion.clone() });
    }
  }
  for (let k = homing.length - 1; k >= 0; k--) {
    const h = homing[k]; h.t = Math.min(1, h.t + dt * 1.8); if (h.t < 0) continue; const e = 1 - (1 - h.t) ** 3;
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
micOrb.position.set(0.78, 1.0, -0.62);
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
  if (sample) return log('Payment matching needs the live backend.');
  try { log('Searching recent payments…'); const r = await api('/api/reconcile', {}); state = r.state; lastSig = ''; render(); log(`Scanned ${r.scanned} transactions: ${r.suggestions.length} match(es) are now approval tablets.`); } catch (e) { log(`⚠️ ${e.message}`); }
};
function setSample(on, why = '') {
  sample = on; sampleWhy = why; $('#sample').textContent = on ? 'Live data' : 'Sample data'; syncSampleLabel(); lastSig = '';
  if (on) { state = sampleState(); render(); } else refresh();
}
$('#sample').onclick = () => setSample(!sample);

// ---------- in-room control console (the HTML bar is invisible inside a headset) ----------
const clickables = [];
const consoleRow = new THREE.Group(); consoleRow.position.set(0.22, 0.7, -0.7); consoleRow.rotation.x = -0.6; scene.add(consoleRow);
function button3d(label, color, x, fn, parent = consoleRow, y = 0) {
  const b = panel(0.31, 0.1, 512);
  b.userData.fn = fn;
  b.userData.paint = (text) => b.draw((g, W, H) => { card(g, W, H, color); g.fillStyle = '#fff'; g.font = 'bold 46px system-ui'; g.textAlign = 'center'; g.fillText(text, W / 2, H * 0.64); });
  b.userData.paint(label); b.position.set(x, y, 0); parent.add(b); clickables.push(b); return b;
}
button3d('⚡ Chase overdue', '#5c2a12f2', -0.495, () => $('#chase').click());
button3d('📣 Briefing', '#16306af2', -0.165, () => $('#brief').click());
button3d('🔍 Match payments', '#16306af2', 0.165, () => $('#match').click());
const sampleBtn3d = button3d('Sample data', '#2a2f4af2', 0.495, () => $('#sample').click());
const moveBtn3d = button3d('📍 Move ledger', '#0f4a4af2', 0, () => startPlacing(), consoleRow, -0.12); moveBtn3d.visible = false;
// Quick questions: one-press prompts for the agent (speech recognition is not available in every headset browser).
const askCol = new THREE.Group(); askCol.position.set(1.08, 0.82, -0.5); askCol.rotation.y = -0.6; scene.add(askCol);
button3d('❓ Who to chase?', '#3b1f5cf2', 0, () => ask('chase', 'Who should I chase first?'), askCol, 0.12);
button3d('💰 Cash summary', '#3b1f5cf2', 0, () => ask('summary', 'Give me a cash flow summary'), askCol, 0);
button3d('🧾 Unpaid list', '#3b1f5cf2', 0, () => ask('unpaid', 'Show unpaid invoices'), askCol, -0.12);
function ask(kind, prompt) {
  if (!sample) return chat(prompt).catch((e) => log(`⚠️ ${e.message}`));
  // Sample room: answer from the sample numbers on screen, so the reply matches what you see.
  quest('chat'); log(`🗣 ${prompt}`);
  const open = state.invoices.filter((i) => ['SENT', 'OVERDUE'].includes(i.status));
  const sm = state.summary; let text;
  if (kind === 'chase') {
    const c = [...state.insights].filter((x) => x.owed > 0).sort((a, b) => (b.overdue - a.overdue) || (b.owed - a.owed))[0];
    text = c ? `Chase ${c.client} first: ${fmt(c.owed)} owed${c.overdue ? `, ${c.overdue} invoice${c.overdue > 1 ? 's' : ''} overdue` : ''}.` : 'Nobody owes you anything right now.';
  } else if (kind === 'summary') text = `${fmt(sm.paid)} paid, ${fmt(sm.outstanding)} outstanding, of which ${fmt(sm.overdue)} is overdue.`;
  else text = open.length ? `${open.length} unpaid: ${open.slice(0, 4).map((i) => `#${i.number} ${i.clientName} ${fmt(i.amount)}`).join('; ')}${open.length > 4 ? '; and more' : ''}.` : 'No unpaid invoices.';
  text += ' (sample data)'; log(text); speak(text);
}
function syncSampleLabel() { sampleBtn3d.userData.paint(sample ? 'Live data' : 'Sample data'); }
function pressButton(b) {
  b.scale.setScalar(0.88); setTimeout(() => b.scale.setScalar(1), 140); blip(); buzz(0.5, 30);
  b.userData.fn();
}
function blip() {
  try {
    audio ||= new AudioContext(); const o = audio.createOscillator(); const g = audio.createGain(); o.type = 'triangle'; o.frequency.value = 660;
    g.gain.setValueAtTime(0.15, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.13);
  } catch { /* no audio */ }
}

// ---------- guided tutorial ----------
const QUEST = [['grab', 'Pinch an invoice to grab it'], ['remind', 'Point at Remind and let go'], ['approve', 'Drop the tablet on APPROVE'], ['chat', 'Ask a quick question (right)'], ['chase', 'Press “Chase overdue”']];
const questDone = new Set();
const questPanel = panel(0.9, 0.5, 768);
questPanel.position.set(-1.2, 1.62, -1.25); questPanel.rotation.y = 0.75; scene.add(questPanel);
function drawQuest() {
  questPanel.draw((g, W, H) => {
    card(g, W, H, '#10243ef2');
    g.fillStyle = '#7fe0ff'; g.font = 'bold 40px system-ui'; g.fillText(`Get started  ${questDone.size}/${QUEST.length}`, 30, 62);
    g.font = '34px system-ui';
    const next = QUEST.find((q) => !questDone.has(q[0]));
    QUEST.forEach(([k, text], i) => {
      const done = questDone.has(k);
      g.fillStyle = done ? '#4cd98a' : next && next[0] === k ? '#ffffff' : '#7d8bbd';
      g.fillText(`${done ? '✔' : next && next[0] === k ? '➜' : '○'}  ${text}`, 30, 128 + i * 58);
    });
  });
}
drawQuest();
function quest(evt) {
  if (questDone.has(evt) || !QUEST.some((q) => q[0] === evt)) return;
  questDone.add(evt); drawQuest();
  if (questDone.size === QUEST.length) { chime(); log('🎓 Tutorial complete. You know everything now.'); setTimeout(() => { questPanel.visible = false; }, 8000); }
}

// ---------- 4-week cash forecast ----------
const forecastPanel = panel(0.9, 0.42, 768);
forecastPanel.position.set(1.05, 2.45, -1.85); forecastPanel.rotation.y = -0.35; scene.add(forecastPanel);
function drawForecast(s) {
  const names = ['Late', 'This wk', '+1 wk', '+2 wk', 'Later']; const sums = [0, 0, 0, 0, 0];
  for (const i of s.invoices || []) {
    if (!['SENT', 'OVERDUE'].includes(i.status) || !i.dueDate) continue;
    const d = (new Date(i.dueDate + 'T23:59:59Z') - Date.now()) / DAY;
    sums[d < 0 ? 0 : Math.min(4, 1 + Math.floor(d / 7))] += i.amount;
  }
  const max = Math.max(1, ...sums);
  forecastPanel.draw((g, W, H) => {
    card(g, W, H);
    g.fillStyle = '#8fb0ff'; g.font = 'bold 34px system-ui'; g.fillText('Cash expected in', 26, 52);
    g.textAlign = 'right'; g.fillStyle = '#fff'; g.fillText(fmt(sums.reduce((a, b) => a + b, 0)), W - 26, 52); g.textAlign = 'center';
    const bw = (W - 80) / 5;
    sums.forEach((v, i) => {
      const x = 40 + i * bw, h = 170 * v / max;
      g.fillStyle = i === 0 ? '#ff7c8a' : '#5bff9c'; g.fillRect(x + 14, 262 - h, bw - 28, h);
      g.fillStyle = '#fff'; g.font = '24px system-ui'; if (v) g.fillText(fmt(v), x + bw / 2, 252 - h);
      g.fillStyle = '#aab4d4'; g.fillText(names[i], x + bw / 2, 298);
    });
  });
}

// ---------- XR entry buttons (VR and passthrough MR) ----------
const vrBtn = VRButton.createButton(renderer, { optionalFeatures: ['local-floor', 'hand-tracking'] });
const arBtn = ARButton.createButton(renderer, { optionalFeatures: ['local-floor', 'hand-tracking', 'hit-test'] });
for (const b of [vrBtn, arBtn]) { b.style.bottom = 'auto'; b.style.top = '12px'; }
vrBtn.style.left = arBtn.style.left = 'auto'; vrBtn.style.right = '162px'; arBtn.style.right = '12px';
vrBtn.style.width = arBtn.style.width = '140px';
document.body.append(vrBtn, arBtn);
// Mixed reality: your real room is the room. A reticle follows real surfaces; pinch to place the ledger there.
const mr = { placing: false, source: null, base: null, reticle: new THREE.Mesh(new THREE.RingGeometry(0.09, 0.12, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7fe0ff })) };
mr.reticle.matrixAutoUpdate = false; mr.reticle.visible = false; scene.add(mr.reticle);
const ledgerParts = () => [invoiceGroup, pendingGroup, orbGroup, consoleRow, askCol, table, river, micOrb, ...targets.map((t) => t.group)];
async function startPlacing() {
  const session = renderer.xr.getSession(); if (!session || renderer.xr.getSession().environmentBlendMode === 'opaque') return log('Placing works in mixed reality (Enter AR).');
  try {
    if (!mr.base) mr.base = renderer.xr.getReferenceSpace();
    renderer.xr.setReferenceSpace(mr.base);
    if (!mr.source) mr.source = await session.requestHitTestSource({ space: await session.requestReferenceSpace('viewer') });
    mr.placing = true; for (const g of ledgerParts()) g.visible = false;
    log('Look at the floor in front of your desk and pinch to place your ledger there.');
  } catch { log('This headset browser cannot detect surfaces; the ledger stays in front of you.'); }
}
function placeLedger() {
  const p = new THREE.Vector3().setFromMatrixPosition(mr.reticle.matrix);
  const pose = renderer.xr.getFrame()?.getViewerPose(mr.base); if (!pose) return;
  const h = pose.transform.position; const d = new THREE.Vector3(p.x - h.x, 0, p.z - h.z);
  if (d.lengthSq() < 1e-4) d.set(0, 0, -1); d.normalize();
  const yaw = Math.atan2(-d.x, -d.z); const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const o = p.clone().addScaledVector(d, 0.75); // the ledger's centre sits where you pointed
  renderer.xr.setReferenceSpace(mr.base.getOffsetReferenceSpace(new XRRigidTransform({ x: o.x, y: 0, z: o.z }, { x: q.x, y: q.y, z: q.z, w: q.w })));
  mr.placing = false; mr.reticle.visible = false; for (const g of ledgerParts()) g.visible = true;
  chime(); buzz(0.8, 60); quest('place'); log('Ledger placed in your room. Use 📍 Move ledger to put it somewhere else.');
}
// Seated or standing: measure the real eye height once and move the room so the shelf sits just below your
// hands either way (the "airplane seat test": everything stays within about 2 ft).
const DESIGN_EYE = 1.55;
async function fitToHeight() {
  const session = renderer.xr.getSession(); const base = renderer.xr.getReferenceSpace();
  for (let i = 0; i < 30; i++) {
    const eyeY = await new Promise((r) => session.requestAnimationFrame((t, f) => r(f.getViewerPose(base)?.transform.position.y))); // read inside the frame callback
    if (eyeY == null) continue;
    const dy = eyeY - DESIGN_EYE;
    if (Math.abs(dy) > 0.08) renderer.xr.setReferenceSpace(base.getOffsetReferenceSpace(new XRRigidTransform({ x: 0, y: dy, z: 0 })));
    if (dy < -0.2) log('Seated mode: the ledger moved down to your eye level.');
    return;
  }
}
function stepPlacement() {
  if (!mr.placing || !mr.source) return;
  const frame = renderer.xr.getFrame(); const hit = frame?.getHitTestResults(mr.source)[0];
  const pose = hit?.getPose(mr.base);
  mr.reticle.visible = !!pose; if (pose) mr.reticle.matrix.fromArray(pose.transform.matrix);
}
renderer.xr.addEventListener('sessionstart', () => {
  const ar = renderer.xr.getSession().environmentBlendMode !== 'opaque';
  room.visible = !ar; scene.background = ar ? null : roomBg; // MR: your real room becomes the room
  moveBtn3d.visible = ar;
  if (ar) startPlacing(); else { log('VR session started. Pinch or pull the trigger to grab; point at a bin and let go to drop.'); fitToHeight(); }
});
renderer.xr.addEventListener('sessionend', () => {
  room.visible = true; scene.background = roomBg; mr.placing = false; mr.reticle.visible = false; mr.source = null; mr.base = null; moveBtn3d.visible = false;
  for (const g of ledgerParts()) g.visible = true;
});
// Clean pause/resume: stop polling while the page or headset session is hidden.
let paused = false;
const setPaused = (v) => { paused = v; if (!v) refresh(); };
document.addEventListener('visibilitychange', () => setPaused(document.hidden));
renderer.xr.addEventListener('sessionstart', () => renderer.xr.getSession().addEventListener('visibilitychange', (e) => setPaused(e.session.visibilityState === 'hidden')));

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- coin burst (money arrived / approved) ----------
const coinGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.006, 16);
const coinMat = new THREE.MeshStandardMaterial({ color: 0xffd34d, metalness: 0.8, roughness: 0.25, emissive: 0x553300, transparent: true });
const coins = [];
function coinBurst(at, n = 18) {
  for (let i = 0; i < n; i++) {
    const c = new THREE.Mesh(coinGeo, coinMat.clone());
    c.position.copy(at);
    c.userData.v = new THREE.Vector3((Math.random() - 0.5) * 1.4, 1.6 + Math.random() * 1.4, (Math.random() - 0.5) * 1.4);
    c.userData.spin = new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0);
    c.userData.life = 1.4; scene.add(c); coins.push(c);
  }
}
function stepCoins(dt) {
  for (let k = coins.length - 1; k >= 0; k--) {
    const c = coins[k]; const u = c.userData; u.life -= dt; u.v.y -= 6 * dt;
    c.position.addScaledVector(u.v, dt); c.rotation.x += u.spin.x * dt; c.rotation.y += u.spin.y * dt;
    c.material.opacity = Math.min(1, u.life * 2);
    if (u.life <= 0) { scene.remove(c); c.material.dispose(); coins.splice(k, 1); }
  }
}

// ---------- hover highlight (mouse + controller rays) ----------
let hoverMouse = null;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (mouse.obj) return;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  hoverMouse = hitTest(raycaster.ray.origin, raycaster.ray.direction);
  renderer.domElement.style.cursor = hoverMouse ? 'grab' : raycaster.intersectObjects(clickables).length ? 'pointer' : '';
});
function hoveredSet() {
  const s = new Set(); if (hoverMouse) s.add(hoverMouse);
  if (renderer.xr.isPresenting) for (const x of xrInputs) if (!x.obj) {
    tmpM.identity().extractRotation(x.c.matrixWorld);
    const o = hitTest(new THREE.Vector3().setFromMatrixPosition(x.c.matrixWorld), new THREE.Vector3(0, 0, -1).applyMatrix4(tmpM));
    if (o) { s.add(o); if (x.lastHover !== o) { x.gamepad?.hapticActuators?.[0]?.pulse?.(0.15, 15); x.lastHover = o; } } else x.lastHover = null;
  }
  return s;
}

// ---------- intensity: combo meter, cash river, alarms, impacts ----------
const comboPanel = panel(0.9, 0.42, 512);
comboPanel.position.set(-1.05, 2.45, -1.85); comboPanel.rotation.y = 0.35; scene.add(comboPanel);
const combo = { n: 0, best: 0, moved: 0, last: 0 };
function drawCombo(flash = 0) {
  comboPanel.draw((g, W, H) => {
    card(g, W, H, flash ? '#3a1d5cf2' : '#0f1630ee');
    g.fillStyle = '#b9a2ff'; g.font = 'bold 30px system-ui'; g.fillText('COLLECTION COMBO', 24, 50);
    g.fillStyle = combo.n >= 3 ? '#ffd34d' : '#ffffff'; g.font = 'bold 110px system-ui'; g.fillText(`x${combo.n}`, 24, 170);
    g.fillStyle = '#cfd6ee'; g.font = '26px system-ui'; g.fillText(`best x${combo.best}`, 290, 110); g.fillText(`${fmt(combo.moved)} handled`, 290, 150);
    g.fillStyle = '#7d8bbd'; g.font = '20px system-ui'; g.fillText('act again within 20s to keep the streak', 24, 210);
  });
}
drawCombo();
function bumpCombo(u) {
  const now = performance.now();
  combo.n = now - combo.last < 20000 ? combo.n + 1 : 1; combo.last = now; combo.best = Math.max(combo.best, combo.n);
  combo.moved += u.inv?.amount || u.p?.data?.amount || 0;
  drawCombo(1); setTimeout(() => drawCombo(), 250);
  if (combo.n >= 3) levelUp(combo.n);
}
// cash river: particles streaming along the shelf; speed tracks money outstanding, colour warns of overdue
const riverN = 260, riverPos = new Float32Array(riverN * 3), riverT = new Float32Array(riverN);
for (let i = 0; i < riverN; i++) riverT[i] = Math.random();
const riverGeo = new THREE.BufferGeometry(); riverGeo.setAttribute('position', new THREE.BufferAttribute(riverPos, 3));
const riverMat = new THREE.PointsMaterial({ color: 0x5bff9c, size: 0.022, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
const river = new THREE.Points(riverGeo, riverMat); river.frustumCulled = false; scene.add(river);
function stepIntensity(dt, t) {
  const sm = state?.summary || {}; const out = sm.outstanding || 0, od = sm.overdue || 0;
  const speed = 0.05 + Math.min(0.35, out / 20000);
  riverMat.color.setHex(od > 0 ? 0xffb347 : 0x5bff9c);
  for (let i = 0; i < riverN; i++) {
    riverT[i] = (riverT[i] + dt * speed * (0.6 + (i % 7) / 10)) % 1;
    const a = 0.95 - 1.9 * riverT[i]; const rad = 1.16 + Math.sin(t * 3 + i) * 0.02;
    riverPos.set([Math.sin(a) * rad, 0.76 + (i % 5) * 0.008 + Math.sin(t * 2 + i * 0.7) * 0.01, -Math.cos(a) * rad + 0.1], i * 3);
  }
  riverGeo.attributes.position.needsUpdate = true;
  const share = out ? od / out : 0; // overdue alarm: rings ripple out, red light breathes with the overdue share
  alarmLight.intensity = share ? (0.6 + 2.4 * share) * (0.5 + 0.5 * Math.sin(t * 5)) : 0;
  for (const m of invoiceGroup.children) for (const c of m.children) if (c.userData.alarm !== undefined) {
    const f = (t * 0.9 + c.userData.alarm) % 1; c.scale.setScalar(1 + f * 2.2); c.material.opacity = 1 - f;
  }
  neon.material.color.setHSL(share ? 0.98 : 0.62, 1, 0.45 + 0.15 * Math.sin(t * 2));
  if (combo.n && performance.now() - combo.last > 20000) { combo.n = 0; drawCombo(); }
}
function impact(t) {
  shake.amt = 0.06; thud(); buzz(1, 90);
  coinBurst(t.group.position.clone().add(new THREE.Vector3(0, t.top + 0.05, 0)), 10);
}
function noiseBuf(sec) { const b = audio.createBuffer(1, audio.sampleRate * sec, audio.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
function whoosh(power) {
  try {
    audio ||= new AudioContext(); const src = audio.createBufferSource(); src.buffer = noiseBuf(0.5); const f = audio.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, audio.currentTime); f.frequency.exponentialRampToValueAtTime(2400, audio.currentTime + 0.35);
    const g = audio.createGain(); g.gain.setValueAtTime(0.0001, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.25 * power, audio.currentTime + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.45);
    src.connect(f).connect(g).connect(audio.destination); src.start();
  } catch { /* no audio */ }
}
function thud() {
  try {
    audio ||= new AudioContext(); const o = audio.createOscillator(); const g = audio.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(140, audio.currentTime); o.frequency.exponentialRampToValueAtTime(45, audio.currentTime + 0.25);
    g.gain.setValueAtTime(0.5, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.3);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.32);
  } catch { /* no audio */ }
}
function levelUp(n) {
  try {
    audio ||= new AudioContext();
    [523, 659, 784, 1046].forEach((f, i) => { const o = audio.createOscillator(); const g = audio.createGain(); o.type = 'square'; o.frequency.value = f * (1 + (n - 3) * 0.06);
      const at = audio.currentTime + i * 0.07; g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.08, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      o.connect(g).connect(audio.destination); o.start(at); o.stop(at + 0.2); });
  } catch { /* no audio */ }
  log(`🔥 Combo x${n}! Keep going.`);
}

// One click: propose a reminder for every overdue invoice (each still needs approval).
$('#chase').onclick = async () => {
  quest('chase');
  const od = (state?.invoices || []).filter((i) => i.status === 'OVERDUE');
  if (!od.length) return log('Nothing is overdue. 🎉');
  if (sample) { for (const inv of od) sampleAct('remind', { inv, id: inv.id }); return; }
  try { await chat(`Send a reminder for each of these overdue invoices: ${od.map((i) => '#' + i.number).join(', ')}`); } catch (e) { log(`⚠️ ${e.message}`); }
};

// ---------- loop ----------
const clock = new THREE.Clock();
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.45, 0.75));
composer.addPass(new OutputPass());
addEventListener('resize', () => composer.setSize(innerWidth, innerHeight));
let intro = new URLSearchParams(location.search).has('nointro') ? 1 : 0;
const introFrom = new THREE.Vector3(0, 7, 9), introTo = camera.position.clone();
const shake = { amt: 0 };
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta()); const t = clock.elapsedTime;
  for (const s of xrInputs) if (s.obj) { s.hist.push({ p: s.obj.getWorldPosition(new THREE.Vector3()), t }); if (s.hist.length > 6) s.hist.shift(); }
  if (mouse.obj) { mouse.hist.push({ p: mouse.holder.position.clone(), t }); if (mouse.hist.length > 6) mouse.hist.shift(); }
  stepFlying(dt); stepCoins(dt); stepPlacement();
  const hov = hoveredSet();
  for (const m of grabbables.values()) { const target = hov.has(m) || held.has(m) ? 1.12 : 1; m.scale.lerp(new THREE.Vector3(target, target, target), 0.25); }
  for (let k = pulses.length - 1; k >= 0; k--) { const p = pulses[k]; p.life -= dt; p.t.mesh.material.emissiveIntensity = 0.25 + 2 * Math.max(0, p.life); if (p.life <= 0) pulses.splice(k, 1); }
  for (const m of invoiceGroup.children) if (m.userData.inv?.status === 'OVERDUE' && !held.has(m)) m.material.emissiveIntensity = 0.6 + 0.4 * Math.sin(t * 4);
  for (const o of orbGroup.children) o.position.y += Math.sin(t * 1.5 + o.userData.bob) * 0.0008;
  micOrb.scale.setScalar(listening ? 1 + 0.15 * Math.sin(t * 10) : 1);
  for (const lab of targets.map((x) => x.label)) lab.quaternion.copy(camera.quaternion);
  stepIntensity(dt, t);
  if (intro < 1 && !renderer.xr.isPresenting) { intro = Math.min(1, t / 2.6); const e = 1 - (1 - intro) ** 4; camera.position.lerpVectors(introFrom, introTo, e); controls.update(); }
  if (renderer.xr.isPresenting) { renderer.render(scene, camera); } // glow pass is desktop-only: post-processing is too heavy in a headset
  else {
    const off = shake.amt > 0.001 ? new THREE.Vector3((Math.random() - 0.5) * shake.amt, (Math.random() - 0.5) * shake.amt, 0) : null;
    if (off) camera.position.add(off);
    composer.render();
    if (off) camera.position.sub(off);
    shake.amt *= 0.86;
  }
});

// Dev hook used by scripts/record-vr.js: where an object is on screen.
window.tallyspace = {
  world(key) {
    const all = [...grabbables.values()];
    const o = key === 'overdue' ? all.find((m) => m.userData.inv?.status === 'OVERDUE') : key === 'sent' ? all.find((m) => ['SENT', 'OVERDUE'].includes(m.userData.inv?.status))
      : key === 'tablet' ? all.find((m) => m.userData.kind === 'pending') : key.startsWith('bin:') ? targets.find((t) => t.kind === key.slice(4))?.mesh : key.startsWith('btn:') ? clickables[+key.slice(4)] : null;
    return o ? o.getWorldPosition(new THREE.Vector3()).toArray() : null;
  },
  ray(i) { const c = renderer.xr.getController(i); tmpM.identity().extractRotation(c.matrixWorld); return { o: new THREE.Vector3().setFromMatrixPosition(c.matrixWorld).toArray(), d: new THREE.Vector3(0, 0, -1).applyMatrix4(tmpM).toArray() }; },
  locate(key) {
  const all = [...grabbables.values()];
  const o = key === 'overdue' ? all.find((m) => m.userData.inv?.status === 'OVERDUE') : key === 'sent' ? all.find((m) => m.userData.inv?.status === 'SENT')
    : key === 'tablet' ? all.find((m) => m.userData.kind === 'pending') : key.startsWith('bin:') ? targets.find((t) => t.kind === key.slice(4))?.mesh : clickables[+key.slice(4)];
  if (!o) return null;
  const v = o.getWorldPosition(new THREE.Vector3()).project(camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
} };

// ---------- boot ----------
(async () => {
  try { status = await api('/api/status'); } catch { /* handled in refresh */ }
  await refresh();
  if (!sample && !state.invoices.length && !state.pending.length) { setSample(true, 'your live account has no invoices yet'); log('Showing sample data because the live account is empty. Ask the agent for a real invoice and the room switches to live.'); }
  setInterval(refresh, 6000);
})();
