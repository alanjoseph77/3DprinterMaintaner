const $ = s => document.querySelector(s), app = $('#app');
let me = null, tab = 'print', printerSel = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = async (url, body, isForm) => {
  const o = body === undefined ? {} : { method: 'POST', ...(isForm ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
  const r = await fetch(url, o), d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Error'); return d;
};
const tag = s => `<span class="tag ${s}">${s.replace('_', ' ')}</span>`;
const money = n => '₹' + Number(n || 0).toFixed(2);
const liveTag = p => !p.live ? tag(p.status) + ' <span class="mute">not linked</span>' : p.live.online ? tag(p.status) : '<span class="tag failed">offline</span>';
const liveInfo = p => !p.live || !p.live.online ? '' : `<div class="mute" style="font-size:13px;margin-top:4px">${p.live.state === 'RUNNING' ? `${p.live.percent ?? '?'}% · ${p.live.remaining_min ?? '?'} min left<br>` : ''}Nozzle ${Math.round(p.live.nozzle ?? 0)}° · Bed ${Math.round(p.live.bed ?? 0)}°${p.live.file ? '<br>' + esc(p.live.file) : ''}</div>`;
const dur = m => m ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : '–';
const run = fn => async (...a) => { try { await fn(...a); } catch (e) { alert(e.message); } };

async function init() {
  try { me = await api('/api/me'); render(); }
  catch (e) { app.innerHTML = `<div class="card"><h2>Cannot reach the server</h2><p class="err">${esc(e.message)}</p><p class="mute">Check that <code>npm start</code> is still running in the terminal, then press Ctrl+F5.</p></div>`; }
}
function render() {
  $('#who').innerHTML = me ? `${esc(me.name)} <span class="tag">${me.type.toUpperCase()}</span> <button class="alt" onclick="logout()">Logout</button>` : '';
  if (!me) return authView();
  app.innerHTML = `<div class="tabs"><button class="${tab === 'print' ? '' : 'alt'}" onclick="go('print')">New print</button>
    <button class="${tab === 'live' ? '' : 'alt'}" onclick="go('live')">Live printers</button>
    <button class="${tab === 'hist' ? '' : 'alt'}" onclick="go('hist')">My history</button>
    ${me.is_admin ? `<button class="${tab === 'admin' ? '' : 'alt'}" onclick="go('admin')">Admin</button>` : ''}</div><div id="view"></div>`;
  clearInterval(window.liveTimer);
  ({ print: printView, live: liveView, hist: histView, admin: adminView })[tab]();
}
window.go = t => { tab = t; render(); };
window.logout = run(async () => { await api('/api/logout', {}); me = null; render(); });

function authView() {
  app.innerHTML = `<div class="card" style="max-width:360px;margin:auto"><h2>Login / Register</h2>
    <div class="row"><input id="n" placeholder="Name (register only)"></div>
    <div class="row"><input id="e" type="email" placeholder="Email"></div>
    <div class="row"><input id="p" type="password" placeholder="Password (6+)"></div>
    <div class="row"><button onclick="auth('login')">Login</button><button class="alt" onclick="auth('register')">Register</button></div></div>`;
}
window.auth = run(async k => { me = await api('/api/' + k, { name: $('#n').value, email: $('#e').value, password: $('#p').value }); render(); });

async function printView() {
  const [printers, s] = await Promise.all([api('/api/printers'), api('/api/settings')]);
  const csd = me.type === 'csd';
  $('#view').innerHTML = `<div class="card"><h2>1. Choose printer</h2><div class="grid">${printers.map(p =>
    `<div class="pr ${printerSel == p.id ? 'sel' : ''}" onclick="pickPrinter(${p.id},this)"><b>${esc(p.name)}</b><br>${liveTag(p)} <span class="mute">${p.queue} in queue</span>${liveInfo(p)}</div>`).join('')}</div></div>
    <div class="card"><h2>2. Upload file</h2>
    <p class="mute">Use a <b>sliced .3mf</b> from Bambu Studio for exact filament use (.stl gives a rough estimate).<br>
    Rate: ${money(s.rate_per_gram)}/g + ${money(s.rate_per_hour)}/hour, minimum ${money(s.min_price)}. ${csd ? '<b>CSD members print free.</b>' : ''}</p>
    <div class="row"><input type="file" id="f" accept=".3mf,.stl"><button onclick="quote()">Calculate</button></div></div><div id="quote"></div>`;
}
window.printerSel = null;
window.pickPrinter = (id, el) => { printerSel = id; document.querySelectorAll('.pr').forEach(x => x.classList.toggle('sel', x === el)); };
window.quote = run(async () => {
  if (!printerSel) throw new Error('Choose a printer first');
  const f = $('#f').files[0]; if (!f) throw new Error('Choose a file');
  const fd = new FormData(); fd.append('file', f); fd.append('printer_id', printerSel);
  const j = await api('/api/jobs', fd, true), csd = j.user_type === 'csd';
  $('#quote').innerHTML = `<div class="card"><h2>3. Confirm</h2>
    <p><b>${esc(j.file_name)}</b><br>Filament: <b>${j.grams.toFixed(1)} g</b>${j.exact ? '' : ' <span class="err">(rough estimate)</span>'} · Time: ${dur(j.minutes)}</p>
    <p style="font-size:20px">${csd ? '<b>Free (CSD)</b>' : 'Amount: <b>' + money(j.price) + '</b>'}</p>
    <div class="row"><button class="ok" onclick="confirmJob(${j.id})">${csd ? 'Confirm print' : 'Pay now'}</button><button class="alt" onclick="cancelJob(${j.id})">Cancel</button></div></div>`;
});
window.cancelJob = run(async id => { await api(`/api/jobs/${id}/cancel`, {}); $('#quote').innerHTML = ''; });
window.confirmJob = run(async id => {
  await api(`/api/jobs/${id}/confirm`, {});
  const j = (await api('/api/jobs')).find(x => x.id === id);
  if (j.status === 'queued') { alert('Added to the queue!'); return go('hist'); }
  payBox(id);
});
window.payBox = run(async id => {
  const q = await api(`/api/jobs/${id}/qr`);
  $('#quote').innerHTML = `<div class="card"><h2>Pay ${money(q.amount)}</h2>
    <img src="${q.qr}" width="240" alt="UPI QR"><p class="mute">Scan with any UPI app (pay exactly ${money(q.amount)}) or pay to <b>${esc(q.upi_id)}</b>.</p>
    <div class="row"><input id="txn" placeholder="UPI transaction ID" style="min-width:220px"><button onclick="submitTxn(${id})">I have paid</button></div></div>`;
});
window.submitTxn = run(async id => { await api(`/api/jobs/${id}/pay`, { txn_id: $('#txn').value }); alert('Submitted. An admin will confirm your payment.'); go('hist'); });

const thumb = j => `<div class="th" onclick="bigPic(${j.id})"><img src="/api/jobs/${j.id}/thumb" loading="lazy" alt="" onerror="this.parentNode.classList.add('none');this.remove()"><span>🧊</span></div>`;
window.bigPic = id => { const o = document.createElement('div'); o.className = 'ov'; o.onclick = () => o.remove(); o.innerHTML = `<img src="/api/jobs/${id}/thumb" onerror="this.remove()">`; document.body.appendChild(o); };
const jobsTable = (jobs, adm) => `<div class="tbl"><table><tr><th></th><th>#</th><th>When</th>${adm ? '<th>User</th>' : ''}<th>Printer</th><th>File</th><th>g</th><th>Type</th><th>Price</th><th>Txn</th><th>Status</th><th></th></tr>${jobs.map(j => `<tr>
  <td>${thumb(j)}</td><td>${j.id}</td><td>${esc(j.created.slice(0, 16))}</td>${adm ? `<td>${esc(j.user_name)}</td>` : ''}<td>${esc(j.printer)}</td><td>${esc(j.file_name)}</td>
  <td>${j.grams.toFixed(1)}</td><td>${j.user_type}</td><td>${j.user_type === 'csd' ? 'free' : money(j.price)}</td><td>${esc(j.txn_id || '')}</td>
  <td>${tag(j.status)} <span class="mute">${esc(j.note || '')}</span></td>
  <td>${j.status === 'pending_payment' && !adm ? `<button onclick="payBox(${j.id});go('print')">Pay</button>` : ''}${adm ? actions(j) : ''}</td></tr>`).join('')}</table></div>`;
const actions = j => ({
  payment_submitted: `<button class="ok" onclick="act(${j.id},'approve')">Confirm paid</button> <button class="bad" onclick="act(${j.id},'reject')">Reject</button>`,
  queued: `<button onclick="act(${j.id},'start')">Start</button> <button class="bad" onclick="act(${j.id},'reject')">Reject</button>`,
  printing: `<button class="ok" onclick="act(${j.id},'done')">Done</button> <button class="bad" onclick="act(${j.id},'failed')">Failed</button>`,
})[j.status] || '';
window.act = run(async (id, a) => { const note = a === 'reject' ? prompt('Reason?') || '' : ''; await api(`/api/admin/jobs/${id}/${a}`, { note }); adminView(); });

const speedName = n => ({ 1: 'Silent', 2: 'Standard', 3: 'Sport', 4: 'Ludicrous' })[n] || '–';
const liveCard = p => {
  const l = p.live, st = !l ? 'not linked' : !l.online ? 'offline' : l.state === 'RUNNING' ? 'printing' : l.state === 'PAUSE' ? 'paused' : l.state === 'FINISH' ? 'finished' : l.state === 'FAILED' ? 'failed' : 'idle';
  const rows = !l || !l.online ? `<p class="mute">${l?.error ? esc(l.error) : 'No data yet. Admin: add the printer connection details.'}</p>` : `
    ${l.state === 'RUNNING' || l.state === 'PAUSE' ? `<div style="background:var(--line);border-radius:99px;height:12px;overflow:hidden;margin:8px 0"><div style="width:${l.percent || 0}%;height:100%;background:var(--ok)"></div></div>
    <p style="font-size:22px;margin:4px 0"><b>${l.percent ?? '?'}%</b> <span class="mute" style="font-size:14px">${l.remaining_min != null ? dur(l.remaining_min) + ' left' : ''}</span></p>` : ''}
    <table><tr><th>File</th><td>${esc(l.file || l.gcode_file || '–')}</td></tr>
    <tr><th>Layer</th><td>${l.layer ?? '–'} / ${l.total_layers ?? '–'}</td></tr>
    <tr><th>Nozzle</th><td>${l.nozzle != null ? Math.round(l.nozzle) + '°C' : '–'}</td></tr>
    <tr><th>Bed</th><td>${l.bed != null ? Math.round(l.bed) + '°C' : '–'}</td></tr>
    <tr><th>Chamber</th><td>${l.chamber != null ? Math.round(l.chamber) + '°C' : '–'}</td></tr>
    <tr><th>Speed</th><td>${speedName(l.speed)}</td></tr>
    <tr><th>Wi‑Fi</th><td>${esc(l.wifi || '–')}</td></tr>
    ${l.errors ? `<tr><th>Warnings</th><td class="err">${l.errors} active</td></tr>` : ''}</table>`;
  return `<div class="card"><h2>${esc(p.name)} ${tag(st)} <span class="mute" style="font-size:13px">${p.queue} in queue</span></h2>${rows}</div>`;
};
async function liveView() {
  const draw = async () => { const ps = await api('/api/printers'); const el = $('#live'); if (el) el.innerHTML = ps.map(liveCard).join(''); };
  $('#view').innerHTML = '<div id="live" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))"></div><p class="mute">Updates every 5 seconds.</p>';
  await draw(); window.liveTimer = setInterval(() => draw().catch(() => {}), 5000);
}
async function histView() { $('#view').innerHTML = `<div class="card"><h2>My history</h2>${jobsTable(await api('/api/jobs'))}</div>`; }

async function adminView() {
  const [printers, jobs, users, stats, s] = await Promise.all([api('/api/printers'), api('/api/admin/jobs'), api('/api/admin/users'), api('/api/admin/stats'), api('/api/settings')]);
  const waiting = jobs.filter(j => j.status === 'payment_submitted').length;
  $('#view').innerHTML = `<div class="card"><h2>Totals (completed prints)</h2><div class="tbl"><table><tr><th>Printer</th><th>Jobs</th><th>Filament g</th><th>CSD g (free)</th><th>Hours</th><th>Money</th></tr>
    ${stats.map(r => `<tr><td>${r.printer}</td><td>${r.jobs}</td><td>${r.grams}</td><td>${r.csd_grams}</td><td>${r.hours}</td><td>${money(r.money)}</td></tr>`).join('')}</table></div></div>
    <div class="card"><h2>All jobs ${waiting ? `<span class="tag failed">${waiting} payment(s) to confirm</span>` : ''}</h2>${jobsTable(jobs, true)}</div>
    <div class="card"><h2>Users</h2><div class="tbl"><table><tr><th>Name</th><th>Email</th><th>Type</th><th>Admin</th></tr>${users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
      <td><select onchange="setUser(${u.id},{type:this.value})"><option ${u.type === 'individual' ? 'selected' : ''}>individual</option><option ${u.type === 'csd' ? 'selected' : ''}>csd</option></select></td>
      <td><input type="checkbox" ${u.is_admin ? 'checked' : ''} onchange="setUser(${u.id},{is_admin:this.checked})"></td></tr>`).join('')}</table></div></div>
    <div class="card"><h2>Printer connections</h2><p class="mute">Turn on LAN Mode on the printer. Access code, IP and serial are on the printer's network/device screen.</p>
    ${printers.map(p => `<div class="row"><b style="width:50px">${esc(p.name)}</b>${liveTag(p)}
      <input id="ip${p.id}" placeholder="IP" value="${esc(p.ip || '')}" size="14"><input id="sn${p.id}" placeholder="Serial" value="${esc(p.serial || '')}" size="18">
      <input id="ac${p.id}" placeholder="${p.has_code ? 'Access code (saved)' : 'Access code'}" size="12"><button onclick="savePrinter(${p.id})">Connect</button>
      <button class="alt" onclick="rawData(${p.id})">Raw data</button>
      ${p.live?.error ? `<span class="err">${esc(p.live.error)}</span>` : ''}</div>`).join('')}</div>
    <div class="card"><h2>Settings</h2><div class="row">${Object.keys(s).map(k => `<label class="mute">${k}<br><input id="s_${k}" value="${esc(s[k])}"></label>`).join('')}</div>
    <button onclick="saveSettings(${JSON.stringify(Object.keys(s)).replace(/"/g, '&quot;')})">Save</button></div>`;
}
window.savePrinter = run(async id => { await api('/api/admin/printers/' + id, { ip: $('#ip' + id).value, serial: $('#sn' + id).value, access_code: $('#ac' + id).value }); setTimeout(adminView, 3000); alert('Saved. Connecting...'); });
window.rawData = run(async id => { const d = await api(`/api/admin/printers/${id}/raw`); const w = window.open('', '_blank'); w.document.write('<pre>' + esc(JSON.stringify(d, null, 2)) + '</pre>'); });
window.setUser = run(async (id, b) => { await api('/api/admin/users/' + id, b); });
window.saveSettings = run(async keys => { await api('/api/admin/settings', Object.fromEntries(keys.map(k => [k, $('#s_' + k).value]))); alert('Saved'); });

init();
