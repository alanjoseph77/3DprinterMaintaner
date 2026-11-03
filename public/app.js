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
  $('#who').innerHTML = me ? `<span class="bell" onclick="toggleBell()" title="Notifications">🔔<b id="bn" hidden></b></span> ${esc(me.name)} <span class="tag">${me.type.toUpperCase()}</span> <button class="alt" onclick="logout()">Logout</button><div id="bellbox" class="bellbox" hidden></div>` : '';
  if (me) pollBell();
  if (!me) return authView();
  app.innerHTML = `<div class="tabs"><button class="${tab === 'print' ? '' : 'alt'}" onclick="go('print')">New print</button>
    <button class="${tab === 'live' ? '' : 'alt'}" onclick="go('live')">Live printers</button>
    <button class="${tab === 'log' ? '' : 'alt'}" onclick="go('log')">Printer log</button>
    <button class="${tab === 'hist' ? '' : 'alt'}" onclick="go('hist')">My history</button>
    ${me.is_admin ? `<button class="${tab === 'admin' ? '' : 'alt'}" onclick="go('admin')">Admin</button>` : ''}</div><div id="view"></div>`;
  clearInterval(window.liveTimer);
  ({ print: printView, live: liveView, log: logView, hist: histView, admin: adminView })[tab]();
}
document.addEventListener('click', e => { const b = $('#bellbox'); if (b && !b.hidden && !e.target.closest('.bell,#bellbox')) b.hidden = true; });
let lastUnread = 0, bellTimer = null, bellItems = [];
async function pollBell() {
  clearInterval(bellTimer); bellTimer = setInterval(() => me && pollBell().catch(() => {}), 15000);
  const n = await api('/api/notifications'), b = $('#bn'); if (!b) return;
  bellItems = n.items; b.hidden = !n.unread; b.textContent = n.unread;
  if (n.unread > lastUnread && n.items[0] && window.Notification && Notification.permission === 'granted') new Notification('Print Lab', { body: n.items[0].text });
  lastUnread = n.unread;
  if (me.is_admin && tab === 'admin' && n.unread && !document.querySelector('.modal')) adminView();   // new request arrived: refresh the list
}
window.toggleBell = run(async () => {
  const box = $('#bellbox'); if (!box.hidden) { box.hidden = true; return; }
  if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
  box.innerHTML = bellItems.length ? bellItems.map(i => `<div class="bi ${i.is_read ? '' : 'new'}">${esc(i.text)}<br><span class="mute">${esc(i.created.slice(0, 16))}</span></div>`).join('') : '<div class="bi mute">No notifications</div>';
  box.hidden = false; await api('/api/notifications/read', {}); lastUnread = 0; $('#bn').hidden = true;
});
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

let mode = null, bill = null;
window.pickMode = m => { mode = m; bill = null; printView(); };
async function printView() {
  const canCsd = me.type === 'csd';
  $('#view').innerHTML = `<div class="card"><h2>1. What is this print for?</h2><div class="grid">
    <div class="pr ${mode === 'personal' ? 'sel' : ''}" onclick="pickMode('personal')"><b>Personal</b><br><span class="mute">You pay by UPI QR. Admins approve after checking your payment.</span></div>
    <div class="pr ${mode === 'csd' ? 'sel' : ''} ${canCsd ? '' : 'dis'}" onclick="${canCsd ? "pickMode('csd')" : "alert('CSD projects are for CSD members. Ask an admin to mark your account as CSD, or choose Personal.')"}"><b>CSD project</b><br>
      <span class="mute">${canCsd ? 'Free for CSD members. Admins approve.' : 'CSD members only.'}</span></div></div></div><div id="step2"></div><div id="quote"></div>`;
  if (!mode) return;
  const [printers, s, o, projects] = await Promise.all([api('/api/printers'), api('/api/settings'), api('/api/options'), api('/api/projects')]);
  $('#step2').innerHTML = `<div class="card"><h2>2. Upload the part and set print parameters</h2>
    ${mode === 'csd' ? `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
      <label class="mute">Project<br><select id="cp" style="width:100%">${projects.length ? projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('') : '<option value="">No projects yet - ask an admin to add one</option>'}</select></label>
      <label class="mute">Part name<br><input id="cn" maxlength="120" style="width:100%" placeholder="e.g. Sensor bracket"></label></div>
      <div class="row"><textarea id="cd" rows="2" maxlength="1000" placeholder="Describe the part and what it is for" style="width:100%;font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink)"></textarea></div>` : ''}
    <div class="row"><input type="file" id="f" accept=".stl,.3mf"></div>
    <p class="mute" style="margin:2px 0 8px">Upload the part as <b>.stl</b>. A sliced .3mf from Bambu Studio also works and gives exact numbers. Max ${o.build_limit} mm per side.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
      <label class="mute">Material<br><select id="pm">${o.materials.map(m => `<option>${m}</option>`).join('')}</select></label>
      <label class="mute">Layer height<br><select id="pl"><option>0.12</option><option>0.16</option><option selected>0.20</option><option>0.24</option><option>0.28</option></select></label>
      <label class="mute">Infill %<br><input id="pi" type="number" min="0" max="100" value="15" style="width:100%"></label>
      <label class="mute">Copies<br><input id="pc" type="number" min="1" max="20" value="1" style="width:100%"></label>
      <label class="mute">Printer<br><select id="pp"><option value="">Any (admin decides)</option>${printers.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label></div>
    <div class="row"><label><input type="checkbox" id="ps"> Needs supports</label></div>
    <p class="mute">Rate: ${money(s.rate_per_gram)}/g + ${money(s.rate_per_hour)}/hour, minimum ${money(s.min_price)}. <i>Extra parameter changes: contact the admins and come to CSD.</i></p>
    <button onclick="getBill()">Get estimate</button></div>`;
}
window.getBill = run(async () => {
  const f = $('#f').files[0]; if (!f) throw new Error('Choose a file');
  if (bill) { await api(`/api/jobs/${bill.id}/cancel`, {}); bill = null; }
  const fd = new FormData();
  fd.append('file', f); fd.append('mode', mode); fd.append('material', $('#pm').value); fd.append('layer', $('#pl').value); fd.append('infill', $('#pi').value);
  fd.append('copies', $('#pc').value); fd.append('supports', $('#ps').checked); fd.append('printer_id', $('#pp').value);
  if (mode === 'csd') { fd.append('project_id', $('#cp').value); fd.append('part_name', $('#cn').value); fd.append('description', $('#cd').value); }
  bill = await api('/api/jobs', fd, true);
  const csd = bill.user_type === 'csd', q = csd ? null : await api(`/api/jobs/${bill.id}/qr`);
  $('#quote').innerHTML = `<div class="card"><h2>3. Bill</h2>
    <p><b>${esc(bill.part_name || bill.file_name)}</b>${bill.part_name ? ` <span class="mute">(${esc(bill.file_name)})</span>` : ''}${bill.description ? `<br><span class="mute">${esc(bill.description)}</span>` : ''}<br><span class="mute">${esc(bill.material)} · ${bill.layer} mm · ${bill.infill}% infill · ${bill.copies} ${bill.copies > 1 ? 'copies' : 'copy'} · ${bill.supports ? 'with' : 'no'} supports</span></p>
    <table style="max-width:420px"><tr><th>Estimated weight</th><td><b>${bill.grams.toFixed(1)} g</b>${bill.exact ? '' : ' <span class="mute">(estimate)</span>'}</td></tr>
      <tr><th>Estimated time</th><td><b>${dur(bill.minutes)}</b></td></tr>
      <tr><th>Cost</th><td style="font-size:20px"><b>${money(bill.price)}</b>${csd ? ' <span class="mute" style="font-size:13px">not charged (CSD project)</span>' : ''}</td></tr></table>
    ${csd ? '' : `<h2 style="margin-top:14px">4. Pay with the QR code</h2><img src="${q.qr}" width="240" alt="UPI QR"><p class="mute">Scan with any UPI app and pay exactly <b>${money(q.amount)}</b> (or pay to <b>${esc(q.upi_id)}</b>).</p>
      <h2>5. Upload the transaction proof</h2><div class="row"><input type="file" id="proof" accept="image/*,.pdf"></div>
      <div class="row"><input id="txn" placeholder="UPI transaction ID (optional)" style="min-width:240px"></div>`}
    <div class="row"><button class="ok" onclick="submitReq()">${csd ? 'Submit request' : '6. Submit request'}</button><button class="alt" onclick="cancelBill()">Cancel</button></div>
    <p class="mute">Admins are notified, then check material, schedule and print parameters before approving.</p></div>`;
  $('#quote').scrollIntoView({ behavior: 'smooth' });
});
window.cancelBill = run(async () => { if (bill) await api(`/api/jobs/${bill.id}/cancel`, {}); bill = null; $('#quote').innerHTML = ''; });
window.submitReq = run(async () => {
  const fd = new FormData(), p = $('#proof');
  if (p) { if (!p.files[0]) throw new Error('Upload the payment screenshot first'); fd.append('proof', p.files[0]); fd.append('txn_id', $('#txn').value); }
  await api(`/api/jobs/${bill.id}/submit`, fd, true); bill = null; mode = null;
  alert('Request submitted. The admins have been notified; you will get a notification when it is approved.'); go('hist');
});

const thumb = j => `<div class="th" onclick="bigPic(${j.id})"><img src="/api/jobs/${j.id}/thumb" loading="lazy" alt="" onerror="this.parentNode.classList.add('none');this.remove()"><span>🧊</span></div>`;
window.bigPic = id => { const o = document.createElement('div'); o.className = 'ov'; o.onclick = () => o.remove(); o.innerHTML = `<img src="/api/jobs/${id}/thumb" onerror="this.remove()">`; document.body.appendChild(o); };
const jobsTable = (jobs, adm) => `<div class="tbl"><table><tr><th></th><th>#</th><th>When</th>${adm ? '<th>User</th>' : ''}<th>Printer</th><th>File</th><th>g</th><th>Type</th><th>Price</th><th>Txn</th><th>Status</th><th></th></tr>${jobs.map(j => `<tr>
  <td>${thumb(j)}</td><td>${j.id}</td><td>${esc(j.created.slice(0, 16))}</td>${adm ? `<td>${esc(j.user_name)}</td>` : ''}<td>${esc(j.printer)}</td><td>${j.project ? `<span class="tag">${esc(j.project)}</span> ` : ''}${esc(j.part_name || j.file_name)}${j.material ? `<br><span class="mute" style="font-size:12px">${esc(j.material)} · ${j.layer}mm · ${j.infill}%${j.copies > 1 ? ' · x' + j.copies : ''}</span>` : ''}</td>
  <td>${j.grams.toFixed(1)}</td><td>${j.user_type}</td><td>${j.user_type === 'csd' ? 'free' : money(j.price)}</td><td>${esc(j.txn_id || '')}${j.has_proof ? ` <a href="/api/jobs/${j.id}/proof" target="_blank">proof</a>` : ''}</td>
  <td>${tag(j.status)} <span class="mute">${esc(j.note || '')}</span>${j.scheduled ? `<br><span class="mute" style="font-size:12px">scheduled ${esc(j.scheduled.replace('T', ' '))} · ${j.print_mode}</span>` : ''}</td>
  <td>${adm ? actions(j) : j.status === 'submitted' ? `<button class="alt" onclick="cancelSub(${j.id})">Cancel</button>` : ''}</td></tr>`).join('')}</table></div>`;
const actions = j => ({
  submitted: `<button class="ok" onclick="reviewJob(${j.id})">Review</button>`,
  queued: `<button onclick="act(${j.id},'start')">${j.print_mode === 'manual' ? 'Mark printing' : 'Start'}</button> <button class="bad" onclick="act(${j.id},'reject')">Reject</button>`,
  printing: `<button class="ok" onclick="act(${j.id},'done')">Done</button> <button class="bad" onclick="act(${j.id},'failed')">Failed</button>`,
})[j.status] || '';
window.cancelSub = run(async id => { if (!confirm('Cancel this request?')) return; await api(`/api/jobs/${id}/cancel`, {}); histView(); });
window.reviewJob = run(async id => {
  const [jobs, printers, o] = await Promise.all([api('/api/admin/jobs'), api('/api/printers'), api('/api/options')]), j = jobs.find(x => x.id === id);
  const m = document.createElement('div'); m.className = 'ov modal';
  m.innerHTML = `<div class="mbox"><h2>Review request #${j.id}</h2>
    <div class="row">${thumb(j)}<div><b>${esc(j.part_name || j.file_name)}</b>${j.project ? ` <span class="tag">${esc(j.project)}</span>` : ''}<br>${j.description ? `<span>${esc(j.description)}</span><br>` : ''}<span class="mute">${esc(j.file_name)} · ${esc(j.user_name)} · ${j.user_type === 'csd' ? 'CSD project' : 'Personal'} · ${j.grams.toFixed(1)} g · ${dur(j.minutes)}${j.exact ? '' : ' (estimate)'}${j.geo ? ' · part ' + JSON.parse(j.geo).map(Math.round).join('x') + ' mm' : ''}</span></div></div>
    ${j.user_type === 'csd' ? '' : `<p>Billed: <b>${money(j.price)}</b> · txn <b>${esc(j.txn_id || 'not given')}</b> ${j.has_proof ? `<br><a href="/api/jobs/${j.id}/proof" target="_blank"><img src="/api/jobs/${j.id}/proof" style="max-width:100%;max-height:220px;border-radius:8px;border:1px solid var(--line)" alt="proof" onerror="this.replaceWith('Open proof')"></a>` : ''}<br><span class="mute">Check the amount in your bank / UPI app before approving.</span></p>`}
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
      <label class="mute">Printer<br><select id="rp">${printers.map(p => `<option value="${p.id}" ${p.id === j.printer_id ? 'selected' : ''}>${esc(p.name)} (${p.queue} queued)</option>`).join('')}</select></label>
      <label class="mute">Material<br><select id="rm">${o.materials.map(x => `<option ${x === j.material ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="mute">Layer mm<br><input id="rl" type="number" step="0.01" value="${j.layer ?? 0.2}" style="width:100%"></label>
      <label class="mute">Infill %<br><input id="ri" type="number" value="${j.infill ?? 15}" style="width:100%"></label>
      <label class="mute">Schedule<br><input id="rs" type="datetime-local" style="width:100%"></label></div>
    <div class="row"><label><input type="checkbox" id="rsup" ${j.supports ? 'checked' : ''}> Supports</label>
      <label><input type="checkbox" id="rok"> <b>Material available</b></label></div>
    <div class="row"><b>Print:</b> <label><input type="radio" name="rpm" value="auto" checked> Site prints directly</label> <label><input type="radio" name="rpm" value="manual"> Manually on the printer</label></div>
    <div class="row"><input id="rn" placeholder="Note to user / reject reason" style="width:100%"></div>
    <div class="row"><button class="ok" onclick="decide(${j.id},'approve')">Approve</button><button class="bad" onclick="decide(${j.id},'reject')">Reject</button><button class="alt" onclick="this.closest('.modal').remove()">Close</button></div></div>`;
  document.body.appendChild(m);
});
window.decide = run(async (id, decision) => {
  await api(`/api/admin/jobs/${id}/review`, { decision, printer_id: $('#rp').value, material: $('#rm').value, layer: $('#rl').value, infill: $('#ri').value, supports: $('#rsup').checked,
    scheduled: $('#rs').value, print_mode: document.querySelector('input[name=rpm]:checked').value, material_ok: $('#rok').checked, admin_note: $('#rn').value });
  document.querySelector('.modal').remove(); adminView();
});
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
const took = (a, b) => { if (!a) return '–'; const m = ((b ? new Date(b.replace(' ', 'T') + 'Z') : new Date()) - new Date(a.replace(' ', 'T') + 'Z')) / 60000; return m < 1 ? '<1m' : dur(m); };
async function logView() {
  const jobs = await api('/api/printer-log');
  $('#view').innerHTML = `<div class="card"><h2>Printer log <span class="mute" style="font-size:13px">everything the printers ran</span></h2>
    ${jobs.length ? `<div class="tbl"><table><tr><th></th><th>Started</th><th>Printer</th><th>File</th><th>Who</th><th>Filament</th><th>Took</th><th>Status</th></tr>${jobs.map(j => `<tr>
      <td>${thumb(j)}</td><td>${esc((j.started || j.created).slice(0, 16))}</td><td>${esc(j.printer)}</td><td>${esc(j.file_name)}</td>
      <td>${esc(j.user_name)}${j.source === 'printer' ? ' <span class="tag">direct</span>' : ''}</td><td>${j.grams ? j.grams.toFixed(1) + ' g' : '–'}</td>
      <td>${took(j.started, j.finished)}</td><td>${tag(j.status)} <span class="mute">${esc(j.note || '')}</span></td></tr>`).join('')}</table></div>` : '<p class="mute">Nothing printed yet.</p>'}</div>`;
}
async function histView() { $('#view').innerHTML = `<div class="card"><h2>My history</h2>${jobsTable(await api('/api/jobs'))}</div>`; }

async function adminView() {
  const [printers, projects, jobs, users, stats, s] = await Promise.all([api('/api/printers'), api('/api/projects'), api('/api/admin/jobs'), api('/api/admin/users'), api('/api/admin/stats'), api('/api/settings')]);
  const waiting = jobs.filter(j => j.status === 'submitted').length, pending = jobs.filter(j => j.status === 'submitted');
  $('#view').innerHTML = `${pending.length ? `<div class="card" style="border-color:var(--warn)"><h2>Requests to review (${pending.length})</h2>${jobsTable(pending, true)}</div>` : ''}<div class="card"><h2>Totals (completed prints)</h2><div class="tbl"><table><tr><th>Printer</th><th>Jobs</th><th>Filament g</th><th>CSD g (free)</th><th>Hours</th><th>Money</th></tr>
    ${stats.map(r => `<tr><td>${r.printer}</td><td>${r.jobs}</td><td>${r.grams}</td><td>${r.csd_grams}</td><td>${r.hours}</td><td>${money(r.money)}</td></tr>`).join('')}</table></div></div>
    <div class="card"><h2>All jobs ${waiting ? `<span class="tag failed">${waiting} to review</span>` : ''}</h2>${jobsTable(jobs, true)}</div>
    <div class="card"><h2>Users</h2><div class="tbl"><table><tr><th>Name</th><th>Email</th><th>Type</th><th>Admin</th></tr>${users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
      <td><select onchange="setUser(${u.id},{type:this.value})"><option ${u.type === 'individual' ? 'selected' : ''}>individual</option><option ${u.type === 'csd' ? 'selected' : ''}>csd</option></select></td>
      <td><input type="checkbox" ${u.is_admin ? 'checked' : ''} onchange="setUser(${u.id},{is_admin:this.checked})"></td></tr>`).join('')}</table></div></div>
    <div class="card"><h2>CSD projects</h2><p class="mute">CSD members pick one of these when they submit a project request.</p>
    <div class="row">${projects.map(p => `<span class="tag">${esc(p.name)} <a href="#" onclick="rmProject(${p.id});return false" title="Remove">✕</a></span>`).join('') || '<span class="mute">No projects yet.</span>'}</div>
    <div class="row"><input id="np" placeholder="New project name"><button onclick="addProject()">Add project</button></div></div>
    <div class="card"><h2>Printer connections</h2><p class="mute">Turn on LAN Mode on the printer. Access code, IP and serial are on the printer's network/device screen.</p>
    ${printers.map(p => `<div class="row"><b style="width:50px">${esc(p.name)}</b>${liveTag(p)}
      <input id="ip${p.id}" placeholder="IP" value="${esc(p.ip || '')}" size="14"><input id="sn${p.id}" placeholder="Serial" value="${esc(p.serial || '')}" size="18">
      <input id="ac${p.id}" placeholder="${p.has_code ? 'Access code (saved)' : 'Access code'}" size="12"><button onclick="savePrinter(${p.id})">Connect</button>
      <button class="alt" onclick="rawData(${p.id})">Raw data</button><button class="alt" onclick="ftpFiles(${p.id})">Check files</button>
      ${p.live?.error ? `<span class="err">${esc(p.live.error)}</span>` : ''}</div>`).join('')}</div>
    <div class="card"><h2>Settings</h2><div class="row">${Object.keys(s).map(k => `<label class="mute">${k}<br><input id="s_${k}" value="${esc(s[k])}"></label>`).join('')}</div>
    <button onclick="saveSettings(${JSON.stringify(Object.keys(s)).replace(/"/g, '&quot;')})">Save</button></div>`;
}
window.savePrinter = run(async id => { await api('/api/admin/printers/' + id, { ip: $('#ip' + id).value, serial: $('#sn' + id).value, access_code: $('#ac' + id).value }); setTimeout(adminView, 3000); alert('Saved. Connecting...'); });
window.rawData = run(async id => { const d = await api(`/api/admin/printers/${id}/raw`); const w = window.open('', '_blank'); w.document.write('<pre>' + esc(JSON.stringify(d, null, 2)) + '</pre>'); });
window.ftpFiles = run(async id => { const w = window.open('', '_blank'); w.document.write('Checking printer files...'); try { const d = await api(`/api/admin/printers/${id}/files`); w.document.body.innerHTML = '<pre>' + esc(JSON.stringify(d, null, 2)) + '</pre>'; } catch (e) { w.document.body.innerHTML = '<pre>Error: ' + esc(e.message) + '</pre>'; } });
window.addProject = run(async () => { await api('/api/admin/projects', { name: $('#np').value }); adminView(); });
window.rmProject = run(async id => { if (confirm('Remove this project from the list? Existing requests keep it.')) { await api(`/api/admin/projects/${id}/remove`, {}); adminView(); } });
window.setUser = run(async (id, b) => { await api('/api/admin/users/' + id, b); });
window.saveSettings = run(async keys => { await api('/api/admin/settings', Object.fromEntries(keys.map(k => [k, $('#s_' + k).value]))); alert('Saved'); });

init();
