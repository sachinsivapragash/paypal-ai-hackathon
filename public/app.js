const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, c = 'USD') => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n); } catch { return `${n} ${c}`; } };
let state = { invoices: [], payouts: [], pending: [], audit: [], summary: {} };
let status = {};

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.data = data; throw e; }
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200); }

function addMsg(text, cls) { const d = document.createElement('div'); d.className = `msg ${cls}`; d.textContent = text; $('#messages').append(d); d.scrollIntoView({ block: 'end' }); return d; }

const LABEL = { create_invoice: 'Send PayPal invoice', send_reminder: 'Send reminder', cancel_invoice: 'Cancel invoice', pay_contractor: 'PayPal payout' };
function cardFields(p) {
  const d = p.data;
  if (p.type === 'create_invoice') return [['Client', d.clientName], ['Email', d.clientEmail], ['Amount', fmt(d.amount, d.currency)], ['For', d.description], ['Terms', `Net ${d.netDays}`], ['Auto reminders', d.reminders]];
  if (p.type === 'pay_contractor') return [['To', d.recipientEmail], ['Amount', fmt(d.amount, d.currency)], ['For', d.note]];
  if (p.type === 'send_reminder') return [['Invoice', `#${d.number} · ${d.clientName}`], ['Amount', fmt(d.amount, d.currency)], ['Message', d.message]];
  return [['Invoice', `#${d.number} · ${d.clientName}`], ['Amount', fmt(d.amount, d.currency)]];
}
function renderCard(p) {
  const el = document.createElement('div');
  el.className = 'card'; el.dataset.id = p.id;
  el.innerHTML = `<h3>${esc(LABEL[p.type] || p.type)} <span class="tag">needs approval</span></h3>
    <dl>${cardFields(p).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="actions"><button class="ok" data-act="approve">Approve</button><button class="bad" data-act="reject">Reject</button></div>`;
  el.addEventListener('click', async (e) => {
    const act = e.target.dataset?.act; if (!act) return;
    el.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const r = await api(`/api/actions/${p.id}/${act}`, {});
      setState(r.state);
      const tag = el.querySelector('.tag');
      if (act === 'approve') {
        el.classList.add('done'); tag.textContent = 'done';
        const res = r.result || {};
        el.querySelector('.actions').innerHTML = res.payLink ? `<a href="${esc(res.payLink)}" target="_blank" rel="noopener">Open PayPal pay link for #${esc(res.number)} ↗</a>` : res.batchId ? `<span>Payout batch ${esc(res.batchId)} · ${esc(res.status)}</span>` : '<span>Done ✓</span>';
        toast(p.type === 'create_invoice' ? `Invoice #${res.number} sent via PayPal` : 'Approved and executed');
      } else { el.classList.add('rejected'); tag.textContent = 'rejected'; el.querySelector('.actions').remove(); }
    } catch (err) {
      el.classList.add('failed'); el.querySelector('.tag').textContent = 'failed';
      addMsg(`PayPal error: ${err.message}. You can retry, it's safe (idempotent).`, 'bot err');
      if (err.data?.state) setState(err.data.state);
      el.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  });
  $('#messages').append(el); el.scrollIntoView({ block: 'end' });
}

function setState(s) { state = s; render(); }

// Invoices: AG Grid Community (sort, filter, resize). Falls back to a plain table if the CDN is unreachable.
let grid = null;
const statusCell = (p) => `<span class="status s-${esc(p.value)}">${esc(p.value)}</span>`;
const actionsCell = (p) => {
  const i = p.data;
  return `<span class="row-actions">${i.payLink && ['SENT', 'OVERDUE'].includes(i.status) ? `<a href="${esc(i.payLink)}" target="_blank" rel="noopener">Pay link</a>` : ''}<button class="ghost small" data-sync="${esc(i.id)}" title="Check status with PayPal">Sync</button></span>`;
};
function renderInvoices(inv) {
  $('#gridEmpty').innerHTML = inv.length ? '' : '<div class="empty"><strong>No invoices yet</strong>Ask the agent to invoice a client and approve the card. In demo mode you can also click "Load sample data".</div>';
  $('#grid').style.display = inv.length ? '' : 'none';
  if (!window.agGrid) {
    $('#grid').innerHTML = inv.length ? `<table><thead><tr><th>#</th><th>Client</th><th class="num">Amount</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>${inv.map((i) => `<tr><td>${esc(i.number)}</td><td>${esc(i.clientName)}</td><td class="num">${fmt(i.amount, i.currency)}</td><td>${statusCell({ value: i.status })}</td><td>${esc(i.dueDate)}</td><td>${actionsCell({ data: i })}</td></tr>`).join('')}</tbody></table>` : '';
    return;
  }
  if (!grid) {
    grid = agGrid.createGrid($('#grid'), {
      rowData: [],
      getRowId: (p) => p.data.id,
      animateRows: true,
      defaultColDef: { sortable: true, filter: true, resizable: true },
      columnDefs: [
        { field: 'number', headerName: '#', width: 90 },
        { field: 'clientName', headerName: 'Client', flex: 1, minWidth: 140 },
        { field: 'description', headerName: 'For', flex: 1, minWidth: 140 },
        { field: 'amount', headerName: 'Amount', width: 120, type: 'rightAligned', filter: 'agNumberColumnFilter', valueFormatter: (p) => fmt(p.value, p.data.currency) },
        { field: 'status', headerName: 'Status', width: 120, cellRenderer: statusCell },
        { field: 'dueDate', headerName: 'Due', width: 120, sort: 'desc' },
        { headerName: 'Reminders', width: 130, valueGetter: (p) => `${p.data.remindersSent || 0} sent · ${p.data.remindersLeft || 0} left` },
        { headerName: '', width: 150, sortable: false, filter: false, cellRenderer: actionsCell },
      ],
    });
  }
  grid.setGridOption('rowData', inv);
}

function renderInsights(list) {
  if (!list.length) { $('#pane-insights').innerHTML = '<div class="empty"><strong>No payment history yet</strong>Insights appear once clients have been invoiced. Ask "Who should I chase first?"</div>'; return; }
  const chase = list.find((c) => c.open > 0);
  $('#pane-insights').innerHTML = `${chase ? `<div class="insight-lead">Chase <b>${esc(chase.client)}</b> first: ${esc(chase.risk)} risk, owes ${fmt(chase.owed)}. Reminders to higher-risk clients are automatically firmer (still polite).</div>` : ''}
    <table><thead><tr><th>Client</th><th>Risk</th><th class="num">Owed</th><th class="num">Avg days to pay</th><th class="num">Paid late</th><th class="num">Invoices</th></tr></thead><tbody>${list.map((c) => `
    <tr><td>${esc(c.client)}</td><td><span class="risk risk-${esc(c.risk)}">${esc(c.risk)}</span></td><td class="num">${fmt(c.owed)}</td><td class="num">${c.avgDaysToPay ?? '–'}</td><td class="num">${c.lateRate}%</td><td class="num">${c.invoices}</td></tr>`).join('')}</tbody></table>`;
}
function render() {
  const s = state.summary || {};
  const mins = s.minutesSaved || 0;
  $('#kpis').innerHTML = [['Collected', fmt(s.paid || 0), 'ok'], ['Outstanding', fmt(s.outstanding || 0), 'warn'], ['Overdue', fmt(s.overdue || 0), 'bad'], ['Admin time saved (est.)', mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`, 'info']]
    .map(([k, v, c]) => `<div class="kpi ${c}"><span>${k}</span><strong>${v}</strong></div>`).join('');

  renderInvoices(state.invoices);
  renderInsights(state.insights || []);

  const pay = state.payouts;
  $('#pane-payouts').innerHTML = pay.length ? `<table><thead><tr><th>To</th><th class="num">Amount</th><th>For</th><th>Status</th><th>Batch</th></tr></thead><tbody>${pay.map((p) => `
    <tr><td>${esc(p.recipientEmail)}</td><td class="num">${fmt(p.amount, p.currency)}</td><td>${esc(p.note)}</td><td><span class="status s-${esc(p.status)}">${esc(p.status)}</span></td><td><small>${esc(p.batchId)}</small></td></tr>`).join('')}</tbody></table>`
    : `<div class="empty"><strong>No payouts yet</strong>Try "Pay maria@studio.example.com 120 USD for illustrations". Capped at ${fmt(status.maxPayoutAmount || 500)} per payout.</div>`;

  $('#pane-audit').innerHTML = state.audit.length ? state.audit.map((a) => `<div class="audit-item"><time>${new Date(a.at).toLocaleTimeString()}</time><span class="actor">${esc(a.actor)} · ${esc(a.action)}</span><code>${esc(JSON.stringify(a.details))}</code></div>`).join('')
    : '<div class="empty"><strong>Audit log is empty</strong>Every agent proposal, approval, PayPal call and webhook is recorded here.</div>';
}

$('#pane-invoices').addEventListener('click', async (e) => {
  const id = e.target.dataset?.sync; if (!id) return;
  e.target.disabled = true;
  try { setState((await api(`/api/invoices/${id}/sync`, {})).state); toast('Synced with PayPal'); } catch (err) { toast(err.message); } finally { e.target.disabled = false; }
});
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('hidden', p.id !== `pane-${t.dataset.tab}`));
}));

$('#chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chatInput'); const text = input.value.trim(); if (!text) return;
  input.value = ''; addMsg(text, 'user');
  const typing = addMsg('DuePilot is thinking…', 'bot typing'); $('#sendBtn').disabled = true;
  try {
    const r = await api('/api/chat', { message: text });
    typing.remove(); addMsg(r.reply, 'bot');
    r.proposals.filter(Boolean).forEach(renderCard); setState(r.state);
  } catch (err) { typing.remove(); addMsg(`Something went wrong: ${err.message}`, 'bot err'); }
  finally { $('#sendBtn').disabled = false; input.focus(); }
});

$('#seedBtn').addEventListener('click', async () => { try { setState(await api('/api/demo/seed', {})); toast('Loaded sample clients and payment history'); } catch (err) { toast(err.message); } });

const CHIPS = ['Invoice Acme Corp ap@acme.example.com 450 USD for the logo work, net 7, remind them twice', 'Who should I chase first?', 'Show unpaid invoices', 'Remind Acme', 'Pay maria@studio.example.com 120 USD for illustrations', 'Cash flow summary'];
$('#chips').innerHTML = CHIPS.map((c) => `<button class="chip" type="button">${esc(c.length > 34 ? c.slice(0, 32) + '…' : c)}</button>`).join('');
$('#chips').querySelectorAll('.chip').forEach((b, i) => b.addEventListener('click', () => { $('#chatInput').value = CHIPS[i]; $('#chatInput').focus(); }));

$('#remindBtn').addEventListener('click', async () => {
  try { const r = await api('/api/reminders/run', { force: true }); setState(r.state); toast(r.sent.length ? `Sent reminders for #${r.sent.join(', #')}` : 'No unpaid invoices with reminders left'); } catch (err) { toast(err.message); }
});
$('#resetBtn').addEventListener('click', async () => { if (!confirm('Clear all invoices, payouts and the audit log?')) return; setState(await api('/api/reset', {})); $('#messages').innerHTML = ''; greet(); });

// Voice input via the browser's Web Speech API (Chrome/Edge).
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('#micBtn').style.display = 'none';
else $('#micBtn').addEventListener('click', () => {
  const r = new SR(); r.lang = 'en-US'; r.interimResults = false;
  $('#micBtn').classList.add('mic-on');
  r.onresult = (e) => { $('#chatInput').value = e.results[0][0].transcript; };
  r.onend = () => $('#micBtn').classList.remove('mic-on');
  r.start();
});

function greet() { addMsg(`Hi! I'm DuePilot. Tell me who to invoice or pay in plain English. I draft it, you approve it, PayPal does the rest.${status.paypal === 'demo' ? '\n\n(Demo mode: PayPal is simulated locally because no sandbox keys are set.)' : ''}`, 'bot'); }

(async function init() {
  try {
    status = await api('/api/status');
    $('#badges').innerHTML = `<span class="badge">PayPal: <b>${status.paypal === 'sandbox' ? 'Sandbox' : 'Demo simulator'}</b></span><span class="badge">AI: <b>${esc(status.ai)}</b></span><span class="badge">Webhook signatures: <b>${status.webhookVerification ? 'verified' : status.paypal === 'sandbox' ? 'not set up yet' : 'n/a in demo'}</b></span>`;
    if (status.paypal === 'demo') $('#seedBtn').classList.remove('hidden');
    setState(await api('/api/state'));
    state.pending.forEach(renderCard);
  } catch (err) { addMsg(`Can't reach the server: ${err.message}`, 'bot err'); }
  greet();
  setInterval(async () => { try { const s = await api('/api/state'); if (JSON.stringify(s.summary) !== JSON.stringify(state.summary) || s.audit[0]?.id !== state.audit[0]?.id) setState(s); } catch {} }, 5000);
})();
