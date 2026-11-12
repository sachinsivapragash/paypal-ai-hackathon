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

// Scroll only the chat box, never the whole page (so the hero stays in view on load).
function scrollChat() { const m = $('#messages'); requestAnimationFrame(() => { m.scrollTop = m.scrollHeight; }); }
function addMsg(text, cls) { const d = document.createElement('div'); d.className = `msg ${cls}`; d.textContent = text; $('#messages').append(d); scrollChat(); return d; }

const LABEL = { create_invoice: '🧾 Send PayPal invoice', send_reminder: '🔔 Send reminder', cancel_invoice: '✖ Cancel invoice', pay_contractor: '💸 PayPal payout', record_payment: '🔎 Match payment to invoice', create_recurring: '🔁 Set up recurring invoice' };
const APPROVE = { create_invoice: 'Approve & send via PayPal', send_reminder: 'Approve & send reminder', cancel_invoice: 'Approve cancellation', pay_contractor: 'Approve payout', record_payment: 'Approve & mark paid', create_recurring: 'Approve schedule' };
const SAFE = { create_invoice: 'Nothing has been sent yet.', send_reminder: 'Nothing has been sent yet.', cancel_invoice: 'The invoice is still active.', pay_contractor: 'No money has moved. Capped at your payout limit.', record_payment: 'Nothing changes on PayPal until you approve.', create_recurring: 'No invoice is created yet. Each one will still need your approval (or Autopilot).' };
function cardFields(p) {
  const d = p.data;
  if (p.type === 'create_invoice') return [['Client', d.clientName], ['Email', d.clientEmail], ['For', d.description],
    ...(d.items?.length ? d.items.map((it, i) => [i ? '' : 'Items', `${it.quantity} × ${it.name} @ ${fmt(it.unitAmount, d.currency)}`]) : []),
    ['Total', fmt(d.amount, d.currency)], ['Terms', `Net ${d.netDays}`], ['Auto reminders', d.reminders]];
  if (p.type === 'create_recurring') return [['Client', d.clientName], ['Email', d.clientEmail], ['For', d.description], ['Amount', `${fmt(d.amount, d.currency)} every ${d.every}`], ['First invoice', d.startDate], ['Terms', `Net ${d.netDays}`]];
  if (p.type === 'record_payment') return [['Payment', `${fmt(d.amount, d.currency)} from ${d.payer || 'unknown'} on ${d.date}`], ['Invoice', `#${d.number} · ${d.clientName}`], ['Confidence', d.confidence], ['Why', d.reasons.join(', ')], ['PayPal txn', d.transactionId]];
  if (p.type === 'pay_contractor') return [['To', d.recipientEmail], ['Amount', fmt(d.amount, d.currency)], ['For', d.note]];
  if (p.type === 'send_reminder') return [['Invoice', `#${d.number} · ${d.clientName}`], ['Amount', fmt(d.amount, d.currency)], ['Message', d.message]];
  return [['Invoice', `#${d.number} · ${d.clientName}`], ['Amount', fmt(d.amount, d.currency)]];
}
function renderCard(p) {
  const el = document.createElement('div');
  el.className = 'card'; el.dataset.id = p.id;
  el.innerHTML = `<h3>${esc(LABEL[p.type] || p.type)} <span class="tag">needs approval</span></h3>
    <dl>${cardFields(p).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <p class="safe">🔒 ${esc(SAFE[p.type] || 'Waiting for your approval.')}</p>
    <div class="actions"><button class="ok" data-act="approve">${esc(APPROVE[p.type] || 'Approve')}</button><button class="bad" data-act="reject">Reject</button></div>`;
  const ap = p.autopilot;
  if (ap && !ap.auto) el.querySelector('.safe').insertAdjacentHTML('afterend', `<p class="ap-note">⚡ Autopilot left this for you: ${esc(ap.reason)}.</p>`);
  // Already executed by Autopilot: show it as done, with the rule that allowed it.
  if (p.status === 'DONE' || p.status === 'FAILED') {
    const res = p.result || {};
    el.classList.add(p.status === 'DONE' ? 'done' : 'failed');
    el.querySelector('.tag').textContent = p.status === 'DONE' ? (ap?.auto ? 'autopilot' : 'done') : 'failed';
    el.querySelector('.safe').outerHTML = ap?.auto ? `<p class="ap-note auto">⚡ Approved by Autopilot: ${esc(ap.reason)}.</p>` : '';
    if (p.status === 'DONE') el.querySelector('.actions').innerHTML = res.payLink ? `<a class="paylink" href="${esc(res.payLink)}" target="_blank" rel="noopener">Open PayPal pay link for #${esc(res.number)} ↗</a>` : '<span>Done ✓</span>';
    else el.querySelector('.actions').insertAdjacentHTML('afterbegin', `<span class="muted">Failed: ${esc(p.error || '')}</span>`);
  }
  el.addEventListener('click', async (e) => {
    const act = e.target.dataset?.act; if (!act) return;
    el.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const r = await api(`/api/actions/${p.id}/${act}`, {});
      setState(r.state);
      const tag = el.querySelector('.tag');
      if (act === 'approve') {
        el.classList.add('done'); tag.textContent = 'done';
        el.querySelector('.safe')?.remove();
        const res = r.result || {};
        el.querySelector('.actions').innerHTML = res.payLink ? `<a class="paylink" href="${esc(res.payLink)}" target="_blank" rel="noopener">Open PayPal pay link for #${esc(res.number)} ↗</a><span class="muted">Share it with the client, or pay it as the sandbox buyer.</span>` : res.batchId ? `<span>Payout batch <b>${esc(res.batchId)}</b> · ${esc(res.status)}</span>` : '<span>Done ✓</span>';
        toast(p.type === 'create_invoice' ? `Invoice #${res.number} sent via PayPal` : 'Approved and executed');
      } else { el.classList.add('rejected'); tag.textContent = 'rejected'; el.querySelector('.actions').remove(); }
    } catch (err) {
      el.classList.add('failed'); el.querySelector('.tag').textContent = 'failed';
      addMsg(`PayPal error: ${err.message}. You can retry, it's safe (idempotent).`, 'bot err');
      if (err.data?.state) setState(err.data.state);
      el.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  });
  $('#messages').append(el); scrollChat();
}

function setState(s) { state = s; render(); }

// Invoices: AG Grid Community (sort, filter, resize). Falls back to a plain table if the CDN is unreachable.
let grid = null;
const statusCell = (p) => `<span class="status s-${esc(p.value)}">${esc(p.value)}</span>`;
const actionsCell = (p) => {
  const i = p.data;
  return `<span class="row-actions">${i.payLink && ['SENT', 'OVERDUE'].includes(i.status) ? `<a href="${esc(i.payLink)}" target="_blank" rel="noopener">Pay link</a><button class="ghost small" data-qr="${esc(i.id)}" title="PayPal QR code: client scans to pay">QR</button>` : ''}<button class="ghost small" data-sync="${esc(i.id)}" title="Check status with PayPal">Sync</button></span>`;
};
function renderInvoices(inv) {
  $('#gridEmpty').innerHTML = inv.length ? '' : '<div class="empty"><span class="em-ic">🧾</span><strong>No invoices yet</strong>Ask the agent to invoice a client and approve the card. In demo mode you can also click "Load sample data".</div>';
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

// "Scan to pay" dialog: QR code generated by PayPal for the invoice.
async function showQr(id) {
  const dlg = $('#qrDialog');
  $('#qrBox').innerHTML = '<p>Asking PayPal for the QR code…</p>'; $('#qrSub').textContent = ''; $('#qrLink').removeAttribute('href');
  dlg.showModal();
  try {
    const r = await api(`/api/invoices/${id}/qr`);
    $('#qrSub').textContent = `Invoice #${r.number} · ${r.client} · ${fmt(r.amount, r.currency)}. The client scans this with their phone camera to pay on PayPal.`;
    $('#qrBox').innerHTML = r.png ? `<img alt="PayPal QR code to pay invoice #${esc(r.number)}" src="data:image/png;base64,${r.png}">` : '<p>QR codes come from PayPal, so they appear with real sandbox keys. In demo mode, use the pay link.</p>';
    if (r.payLink) $('#qrLink').href = r.payLink;
  } catch (err) { $('#qrBox').innerHTML = `<p>${esc(err.message)}</p>`; }
}
$('#qrClose').addEventListener('click', () => $('#qrDialog').close());

// ---- Recurring tab: retainers that draft an invoice every week or month ----
function renderRecurring(list) {
  if (!list.length) { $('#pane-recurring').innerHTML = '<div class="empty"><span class="em-ic">🔁</span><strong>No recurring invoices yet</strong>Try "Invoice Kestrel Labs finance@kestrel.example.com $500 every month for website maintenance".</div>'; return; }
  $('#pane-recurring').innerHTML = `<div class="insight-lead muted">Each period DuePilot drafts the invoice. It then waits for your approval, unless your Autopilot rules allow it.</div>
    <table><thead><tr><th>Client</th><th>For</th><th class="num">Amount</th><th>Every</th><th>Next</th><th class="num">Sent</th><th>Status</th><th></th></tr></thead><tbody>${list.map((r) => `
    <tr><td>${esc(r.clientName)}</td><td>${esc(r.description)}</td><td class="num">${fmt(r.amount, r.currency)}</td><td>${esc(r.every)}</td><td>${esc(r.nextRunAt)}</td><td class="num">${r.runs || 0}</td>
    <td><span class="status ${r.active ? 's-SENT' : 's-CANCELLED'}">${r.active ? 'ACTIVE' : 'PAUSED'}</span></td>
    <td class="row-actions">${r.active ? `<button class="ghost small" data-rec-run="${esc(r.id)}" title="Draft this period's invoice now">Draft now</button>` : ''}<button class="ghost small" data-rec-toggle="${esc(r.id)}">${r.active ? 'Pause' : 'Resume'}</button></td></tr>`).join('')}</tbody></table>`;
}
$('#pane-recurring').addEventListener('click', async (e) => {
  const run = e.target.dataset?.recRun, tog = e.target.dataset?.recToggle;
  if (!run && !tog) return;
  e.target.disabled = true;
  try {
    if (run) { const r = await api(`/api/recurring/${run}/run`, {}); setState(r.state); renderCard(r.proposal); toast(r.proposal.status === 'DONE' ? 'Invoice drafted and sent by Autopilot' : 'Invoice drafted. Approve it in the chat'); }
    else { setState((await api(`/api/recurring/${tog}/toggle`, {})).state); }
  } catch (err) { toast(err.message); e.target.disabled = false; }
});

// ---- Autopilot tab: standing rules the agent may act on without a click ----
function renderAutopilot(a) {
  if (!a) return;
  const p = a.policy;
  const on = (path, v) => `<input type="checkbox" data-ap="${path}" ${v ? 'checked' : ''} ${path !== 'enabled' && !p.enabled ? 'disabled' : ''}>`;
  const pct = p.dailyLimit ? Math.min(100, Math.round((a.spentToday / p.dailyLimit) * 100)) : 0;
  $('#pane-autopilot').innerHTML = `
    <div class="ap-head">
      <label class="switch big">${on('enabled', p.enabled)}<span></span></label>
      <div><b>Autopilot is ${p.enabled ? 'ON' : 'OFF'}</b><small class="muted">${p.enabled ? 'DuePilot acts on its own inside these rules and logs every action with the rule that allowed it.' : 'Every action waits for your click. Turn on to let DuePilot handle routine work.'}</small></div>
    </div>
    <div class="ap-rules ${p.enabled ? '' : 'off'}">
      <div class="ap-rule"><label class="switch">${on('invoices.enabled', p.invoices.enabled)}<span></span></label>
        <div><b>Send invoices automatically</b><small class="muted">up to <input type="number" min="1" max="${a.hard?.maxInvoiceAmount || 1000}" step="1" data-ap-num="invoices.maxAmount" value="${p.invoices.maxAmount}" ${p.enabled ? '' : 'disabled'}> each
          · <label><input type="checkbox" data-ap="invoices.knownClientsOnly" ${p.invoices.knownClientsOnly ? 'checked' : ''} ${p.enabled ? '' : 'disabled'}> only clients who've paid before</label></small></div></div>
      <div class="ap-rule"><label class="switch">${on('reminders.enabled', p.reminders.enabled)}<span></span></label>
        <div><b>Send reminders automatically</b><small class="muted">polite nudges for unpaid invoices</small></div></div>
      <div class="ap-rule"><label class="switch">${on('matching.enabled', p.matching.enabled)}<span></span></label>
        <div><b>Mark high-confidence payment matches as paid</b><small class="muted">amount + payer email must both match</small></div></div>
      <div class="ap-rule"><span class="lock">🔒</span><div><b>Payouts and cancellations</b><small class="muted">always need you. This can't be switched off.</small></div></div>
      <div class="ap-rule"><span class="lock">✉</span><div><b>Anything from a pasted email</b><small class="muted">always needs you (third-party text is never trusted to act).</small></div></div>
      <div class="ap-cap"><div><b>Daily cap</b> <input type="number" min="0" max="${a.hard?.maxDailyLimit || 2000}" step="10" data-ap-num="dailyLimit" value="${p.dailyLimit}" ${p.enabled ? '' : 'disabled'}> <small class="muted">${fmt(a.spentToday)} invoiced by Autopilot today</small></div>
        <div class="meter"><i style="width:${pct}%"></i></div></div>
    </div>`;
}
async function saveAutopilot(patch) {
  try { const r = await api('/api/autopilot', patch); setState(r.state); toast(r.policy.enabled ? 'Autopilot rules saved' : 'Autopilot is off'); }
  catch (err) { toast(err.message); }
}
function setPath(obj, path, v) { const k = path.split('.'); const o = k.length > 1 ? { [k[0]]: { [k[1]]: v } } : { [k[0]]: v }; return Object.assign(obj, o); }
$('#pane-autopilot').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.ap) saveAutopilot(setPath({}, t.dataset.ap, t.checked));
  if (t.dataset.apNum) saveAutopilot(setPath({}, t.dataset.apNum, Number(t.value)));
});

// Weekly briefing: numbers computed on the server, words written by Gemini (or a template).
function renderBriefing(b) {
  if (!b) {
    $('#briefing').innerHTML = `<div class="b-text"><strong>This week</strong>Get a 20-second summary of what's coming in, who's late and what to do next.</div><div class="b-actions"><button class="small" data-brief="1">Generate briefing</button></div>`;
    return;
  }
  const acts = (b.actions || []).map((a, i) => `<button class="ghost small" data-act-i="${i}">${esc(a.label)}</button>`).join('');
  $('#briefing').innerHTML = `<div class="b-text"><strong>This week · ${esc(b.by.startsWith('gemini') ? 'written by Gemini' : 'summary')}</strong>${esc(b.text)}</div>
    <div class="b-actions">${acts}<button class="ghost small" data-brief="1" title="Regenerate">↻</button></div>`;
}
$('#briefing').addEventListener('click', async (e) => {
  if (e.target.dataset?.brief) {
    e.target.disabled = true; e.target.textContent = '…';
    try { setState((await api('/api/briefing', {})).state); } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Generate briefing'; }
  }
  const i = e.target.dataset?.actI;
  if (i != null) { $('#chatInput').value = state.briefing.actions[Number(i)].prompt; $('#chatInput').focus(); toast('Press Send when ready'); }
});

// Matching tab: PayPal Transaction Search results matched against open invoices.
function renderMatching(r) {
  const head = `<div class="insight-lead"><button id="reconcileBtn" class="small">Check PayPal for payments</button>
    <span class="muted" style="margin-left:8px">Finds money that arrived outside an invoice link and suggests which invoice it pays.</span></div>`;
  if (!r) { $('#pane-matching').innerHTML = head + '<div class="empty"><span class="em-ic">🔎</span><strong>Not checked yet</strong>Click the button, or ask "Did anyone pay me outside an invoice?"</div>'; return; }
  const pend = new Set(state.pending.map((p) => p.id));
  const sug = r.suggestions.map((s) => `<tr><td>${fmt(s.transaction.amount, s.transaction.currency)}</td><td>${esc(s.transaction.payerEmail || s.transaction.payerName || '')}</td><td>#${esc(s.number)} · ${esc(s.clientName)}</td>
    <td><span class="risk risk-${s.confidence === 'high' ? 'low' : 'medium'}">${esc(s.confidence)}</span><br><small class="muted">${esc(s.reasons.join(', '))}</small></td>
    <td>${pend.has(s.pendingId) ? `<button class="ok small" data-match="${esc(s.pendingId)}">Approve</button>` : '<span class="muted">handled</span>'}</td></tr>`).join('');
  const un = r.unmatched.map((u) => `<tr><td>${fmt(u.amount, u.currency)}</td><td>${esc(u.payerEmail || u.payerName || 'unknown')}</td><td colspan="3" class="muted">${u.closest ? `Closest: #${esc(u.closest.number)} (${esc(u.closest.reasons.join(', '))}), not confident enough` : 'No matching invoice'}${u.note ? ` · note: “${esc(u.note)}”` : ''}</td></tr>`).join('');
  $('#pane-matching').innerHTML = head + `<div class="insight-lead muted">Checked ${r.scanned} incoming payment(s) at ${new Date(r.at).toLocaleTimeString()}${r.lastRefreshed ? ` · PayPal data as of ${new Date(r.lastRefreshed).toLocaleString()}` : ''}</div>
    <table><thead><tr><th>Payment</th><th>From</th><th>Invoice</th><th>Match</th><th></th></tr></thead><tbody>${sug || '<tr><td colspan="5" class="muted">No new matches.</td></tr>'}${un}</tbody></table>`;
}
$('#pane-matching').addEventListener('click', async (e) => {
  if (e.target.id === 'reconcileBtn') {
    e.target.disabled = true; e.target.textContent = 'Checking PayPal…';
    try { const r = await api('/api/reconcile', {}); setState(r.state); toast(`${r.suggestions.length} match(es), ${r.unmatched.length} unmatched`); }
    catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Check PayPal for payments'; }
  }
  const id = e.target.dataset?.match;
  if (id) {
    e.target.disabled = true;
    try { const r = await api(`/api/actions/${id}/approve`, {}); setState(r.state); toast(`Invoice #${r.result.number} marked paid on PayPal`); document.querySelector(`.card[data-id="${id}"]`)?.remove(); }
    catch (err) { toast(err.message); e.target.disabled = false; }
  }
});

function renderInsights(list) {
  if (!list.length) { $('#pane-insights').innerHTML = '<div class="empty"><span class="em-ic">📈</span><strong>No payment history yet</strong>Insights appear once clients have been invoiced. Ask "Who should I chase first?"</div>'; return; }
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
  renderMatching(state.reconcile);
  renderBriefing(state.briefing);
  renderAutopilot(state.autopilot);
  renderRecurring(state.recurring || []);
  const apBadge = document.querySelector('#apBadge'); if (apBadge && state.autopilot) apBadge.innerHTML = `<i class="${state.autopilot.policy.enabled ? '' : 'off'}"></i>Autopilot <b>${state.autopilot.policy.enabled ? 'ON' : 'off'}</b>`;

  const pay = state.payouts;
  $('#pane-payouts').innerHTML = pay.length ? `<table><thead><tr><th>To</th><th class="num">Amount</th><th>For</th><th>Status</th><th>Batch</th></tr></thead><tbody>${pay.map((p) => `
    <tr><td>${esc(p.recipientEmail)}</td><td class="num">${fmt(p.amount, p.currency)}</td><td>${esc(p.note)}</td><td><span class="status s-${esc(p.status)}">${esc(p.status)}</span></td><td><small>${esc(p.batchId)}</small></td></tr>`).join('')}</tbody></table>`
    : `<div class="empty"><span class="em-ic">💸</span><strong>No payouts yet</strong>Try "Pay maria@studio.example.com 120 USD for illustrations". Capped at ${fmt(status.maxPayoutAmount || 500)} per payout.</div>`;

  $('#pane-audit').innerHTML = (state.audit.length ? '<div class="insight-lead"><a class="btnlink small" href="/api/export/audit.csv">⬇ Export audit log (CSV)</a> <span class="muted">for your accountant or records</span></div>' : '') + (state.audit.length ? state.audit.map((a) => `<div class="audit-item"><time>${new Date(a.at).toLocaleTimeString()}</time><span class="actor">${esc(a.actor)} · ${esc(a.action)}</span><code>${esc(JSON.stringify(a.details))}</code></div>`).join('')
    : '<div class="empty"><span class="em-ic">🛡</span><strong>Audit log is empty</strong>Every agent proposal, approval, PayPal call and webhook is recorded here.</div>');
}

$('#pane-invoices').addEventListener('click', async (e) => {
  const qr = e.target.dataset?.qr;
  if (qr) { showQr(qr); return; }
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

// Paste-a-client-email intake.
const SAMPLE_EMAIL = 'From: Priya Shah <priya@brightline.example.com>\n\nHi! Loved the work this month. Could you send me the bill for the 3 banner designs at $150 each, plus 1 rush fee at $60? We usually pay within two weeks.\n\nThanks,\nPriya\nBrightline Studio';
$('#emailBtn').addEventListener('click', () => { $('#emailDialog').showModal(); $('#emailText').focus(); });
$('#emailCancel').addEventListener('click', () => $('#emailDialog').close());
$('#emailSample').addEventListener('click', () => { $('#emailText').value = SAMPLE_EMAIL; });
$('#emailForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#emailText').value.trim();
  if (text.length < 10) { toast('Paste the client email first'); return; }
  $('#emailDialog').close();
  addMsg(`📧 Pasted a client email (${text.length} characters)`, 'user');
  const typing = addMsg('DuePilot is reading the email…', 'bot typing');
  try {
    const r = await api('/api/intake', { email: text });
    typing.remove(); addMsg(r.reply, 'bot');
    r.proposals.filter(Boolean).forEach(renderCard); setState(r.state);
    $('#emailText').value = '';
  } catch (err) { typing.remove(); addMsg(`Something went wrong: ${err.message}`, 'bot err'); }
});

$('#seedBtn').addEventListener('click', async () => { try { setState(await api('/api/demo/seed', {})); toast('Loaded sample clients and payment history'); } catch (err) { toast(err.message); } });

const CHIPS = ['Invoice Acme Corp ap@acme.example.com 450 USD for the logo work, net 7, remind them twice', 'Who should I chase first?', 'Invoice Kestrel Labs finance@kestrel.example.com $500 every month for website maintenance', 'Did anyone pay me outside an invoice?', 'Show unpaid invoices', 'Remind Acme', 'Pay maria@studio.example.com 120 USD for illustrations', 'Cash flow summary'];
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

// ---- Welcome tiles: one click fills a realistic request ----
const buyer = () => status.demoBuyerEmail || 'ap@acme.example.com';
const TILES = [
  { ic: '🧾', t: 'Invoice a client', s: 'plain English → PayPal invoice', p: () => `Invoice Acme Corp ${buyer()} $45 for the logo work, net 7, remind them twice` },
  { ic: '✉', t: 'From a client email', s: 'paste it, get an itemised draft', open: 'email' },
  { ic: '🔔', t: 'Chase late payers', s: 'who to nudge, and a polite note', p: () => 'Who should I chase first? Draft them a friendly reminder.' },
  { ic: '🔎', t: 'Match payments', s: 'money that arrived outside an invoice', p: () => 'Did anyone pay me outside an invoice?' },
];
function greet() {
  addMsg(`Hi! I'm DuePilot. Tell me who owes you, or who you need to pay. I draft it, you approve it, PayPal does the rest.${status.paypal === 'demo' ? '\n\n(Demo mode: PayPal is simulated locally because no sandbox keys are set.)' : ''}`, 'bot');
  const box = document.createElement('div');
  box.className = 'tiles';
  box.innerHTML = TILES.map((t, i) => `<button type="button" class="tile" data-tile="${i}"><span class="ti">${t.ic}</span><b>${esc(t.t)}</b><small>${esc(t.s)}</small></button>`).join('');
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tile]'); if (!b) return;
    const t = TILES[Number(b.dataset.tile)];
    if (t.open === 'email') { $('#emailDialog').showModal(); return; }
    $('#chatInput').value = t.p(); $('#chatInput').focus();
  });
  $('#messages').append(box);
}

// ---- Guided 60-second demo: steps tick themselves off from real app state ----
function demoSteps() {
  const inv = state.invoices || [];
  const pendingInvoice = (state.pending || []).find((p) => p.type === 'create_invoice');
  const open = inv.find((i) => ['SENT', 'OVERDUE'].includes(i.status) && i.payLink);
  const paid = inv.some((i) => i.status === 'PAID');
  const sandbox = status.paypal === 'sandbox';
  const steps = [
    { t: 'Ask for an invoice', s: 'Type it, say it, or use the button', done: !!pendingInvoice || inv.length > 0, btn: 'Fill it in', act: () => { $('#chatInput').value = TILES[0].p(); $('#chatInput').focus(); $('#chatInput').scrollIntoView({ block: 'center' }); } },
    { t: 'Approve the card', s: 'Nothing reaches PayPal before this', done: inv.length > 0, btn: 'Show card', act: () => { const c = [...document.querySelectorAll('.card:not(.done):not(.rejected)')].pop(); c ? c.scrollIntoView({ block: 'center', behavior: 'smooth' }) : toast('Send step 1 first'); } },
    { t: 'Pay as the client', s: sandbox ? `PayPal sandbox buyer: ${buyer()}` : 'Opens the simulated pay page', done: paid, btn: 'Open pay link', act: () => (open ? window.open(open.payLink, '_blank', 'noopener') : toast('Approve an invoice first')) },
    { t: 'Watch it reconcile', s: sandbox ? 'Verified PayPal webhook marks it PAID' : 'Payment event marks it PAID', done: paid, btn: null },
  ];
  const cur = steps.findIndex((s) => !s.done);
  $('#demoSteps').innerHTML = steps.map((s, i) => `<li class="step ${s.done ? 'done' : i === cur ? 'current' : ''}">
    <span class="num">${s.done ? '✓' : i + 1}</span><div><b>${esc(s.t)}</b><small>${esc(s.s)}</small></div>
    ${s.btn && !s.done ? `<button class="${i === cur ? '' : 'ghost'} small" data-step="${i}">${esc(s.btn)}</button>` : ''}</li>`).join('');
  demoSteps.list = steps;
}
$('#demoSteps').addEventListener('click', (e) => { const i = e.target.dataset?.step; if (i != null) demoSteps.list[Number(i)].act(); });
$('#startDemo').addEventListener('click', () => { const s = demoSteps.list?.find((x) => !x.done && x.btn); s ? s.act() : toast('Demo complete. Try pasting a client email next.'); });
$('#heroEmail').addEventListener('click', () => $('#emailDialog').showModal());
const storage = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
$('#hideHero').addEventListener('click', () => { $('#hero').classList.add('hidden'); storage.set('dp-hide-hero', '1'); });
if (storage.get('dp-hide-hero')) $('#hero').classList.add('hidden');
const _render = render;
render = function () { _render(); demoSteps(); };

(async function init() {
  // Free Render instances sleep; show a friendly banner if the first request is slow.
  const wake = setTimeout(() => { $('#wake').hidden = false; }, 1500);
  try {
    for (let i = 0; ; i++) { // retry for ~60s while a sleeping server wakes up
      try { status = await api('/api/status'); break; } catch (e) { if (i >= 30) throw e; $('#wake').hidden = false; await new Promise((r) => setTimeout(r, 2000)); }
    }
    const dot = (on) => `<i class="${on ? '' : 'off'}"></i>`;
    $('#badges').innerHTML = `<span class="badge">${dot(true)}PayPal <b>${status.paypal === 'sandbox' ? 'Sandbox' : 'Demo simulator'}</b></span>
      <span class="badge">${dot(!/demo/.test(status.ai))}AI <b>${esc(status.ai.replace('gemini:', 'Gemini · '))}</b></span>
      <span class="badge" id="apBadge"></span>
      <span class="badge">${dot(status.webhookVerification)}Webhooks <b>${status.webhookVerification ? 'verified' : status.paypal === 'sandbox' ? 'not set up' : 'simulated'}</b></span>`;
    if (status.paypal === 'demo') $('#seedBtn').classList.remove('hidden');
    setState(await api('/api/state'));
    state.pending.forEach(renderCard);
  } catch (err) { addMsg(`Can't reach the server: ${err.message}`, 'bot err'); }
  clearTimeout(wake); $('#wake').hidden = true;
  greet();
  setInterval(async () => { try { const s = await api('/api/state'); if (JSON.stringify(s.summary) !== JSON.stringify(state.summary) || s.audit[0]?.id !== state.audit[0]?.id) setState(s); } catch {} }, 5000);
})();
