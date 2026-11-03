const $ = s => document.querySelector(s), root = $('#root');
let me = null, tab = 'print', authMode = 'login';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = async (url, body, isForm) => {
  const o = body === undefined ? {} : { method: 'POST', ...(isForm ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
  const r = await fetch(url, o), d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Error'); return d;
};

// ---- icons (24x24 line icons) ----
const P = {
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  list: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  check: '<path d="M20 6 9 17l-5-5"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', plus: '<path d="M5 12h14M12 5v14"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4h-4"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  thermo: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5M2 17l10 5 10-5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  play: '<path d="m6 3 14 9-14 9z"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  wifi: '<path d="M5 13a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 20 0M12 20h.01"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};
const ic = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

// ---- helpers ----
const LABEL = { submitted: 'Awaiting review', queued: 'Approved - queued', printing: 'Printing', done: 'Done', failed: 'Failed', rejected: 'Rejected', idle: 'Idle', paused: 'Paused', offline: 'Offline', 'not linked': 'Not linked', finished: 'Finished', pending_payment: 'Awaiting payment' };
const tag = s => `<span class="badge ${String(s).replace(/\s+/g, '_')}">${LABEL[s] || esc(s)}</span>`;
const money = n => '₹' + Number(n || 0).toFixed(2);
const liveTag = p => !p.live ? tag('not linked') : p.live.online ? tag(p.status) : tag('offline');
const dur = m => m ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : '–';
const toast = (m, t = 'ok') => { const d = document.createElement('div'); d.className = 'toast ' + t; d.innerHTML = ic(t === 'err' ? 'alert' : 'check') + `<span>${esc(m)}</span>`; $('#toasts').appendChild(d); setTimeout(() => d.remove(), t === 'err' ? 6500 : 3800); };
const run = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 'err'); } };
const field = (label, inner) => `<label class="f">${label}${inner}</label>`;
const empty = (icon, text) => `<div class="empty">${ic(icon)}<span>${text}</span></div>`;

// ---- shell ----
const NAV = [['print', 'New print', 'plus', 'New print request'], ['live', 'Live', 'activity', 'Live printers'], ['log', 'Log', 'list', 'Printer log'], ['hist', 'History', 'clock', 'My history'], ['admin', 'Admin', 'shield', 'Admin']];
async function init() {
  try { me = await api('/api/me'); render(); }
  catch (e) { root.innerHTML = `<div class="authwrap"><div class="card auth"><div class="logo">${ic('alert')}</div><h1>Cannot reach the server</h1><p class="err" style="text-align:center">${esc(e.message)}</p><p class="mute">Check that <code>npm start</code> is still running in the terminal, then press Ctrl+F5.</p></div></div>`; }
}
const ADMIN_TABS = ['live', 'log', 'admin'];   // other users only get New print and My history
function render() {
  if (!me) return authView();
  const items = NAV.filter(n => me.is_admin || !ADMIN_TABS.includes(n[0])), cur = items.find(n => n[0] === tab) || items[0];
  const btn = n => `<button class="nav ${tab === n[0] ? 'on' : ''}" onclick="go('${n[0]}')">${ic(n[2])}<span>${n[1]}</span></button>`;
  root.innerHTML = `<div class="shell">
    <aside class="side"><div class="brand">${ic('printer')}Print Lab</div>${items.map(n => btn([n[0], n[3], n[2]])).join('')}</aside>
    <div class="main"><header class="top"><div class="brand">${ic('printer')}Print Lab</div><h1>${cur[3]}</h1><div class="grow"></div>
      <div class="who"><button class="icon bell" onclick="toggleBell()" title="Notifications" aria-label="Notifications">${ic('bell')}<b id="bn" hidden></b></button>
        <div class="chip"><span class="avatar">${esc(me.name.trim().charAt(0).toUpperCase())}</span><span class="nm">${esc(me.name)}</span><span class="pill">${me.type.toUpperCase()}</span></div>
        <button class="icon" onclick="logout()" title="Log out" aria-label="Log out">${ic('logout')}</button><div id="bellbox" class="bellbox" hidden></div></div></header>
      <main id="view"></main></div>
    <nav class="tabbar">${items.map(btn).join('')}</nav></div>`;
  pollBell();
  clearInterval(window.liveTimer);
  ({ print: printView, live: liveView, log: logView, hist: histView, admin: adminView })[items.some(n => n[0] === tab) ? tab : 'print']();
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
  box.innerHTML = bellItems.length ? bellItems.map(i => `<div class="bi ${i.is_read ? '' : 'new'}">${esc(i.text)}<br><span class="mute small">${esc(i.created.slice(0, 16))}</span></div>`).join('') : '<div class="bi mute">No notifications yet</div>';
  box.hidden = false; await api('/api/notifications/read', {}); lastUnread = 0; $('#bn').hidden = true;
});
window.go = t => { tab = t; render(); window.scrollTo(0, 0); };
window.logout = run(async () => { await api('/api/logout', {}); me = null; render(); });

// ---- login ----
function authView() {
  const reg = authMode === 'register';
  root.innerHTML = `<div class="authwrap"><form class="card auth" onsubmit="auth(event)"><div class="logo">${ic('printer')}</div><h1>Print Lab</h1><p class="mute">Request 3D prints on the lab printers</p>
    <div class="seg"><button type="button" class="${reg ? '' : 'on'}" onclick="setAuth('login')">Log in</button><button type="button" class="${reg ? 'on' : ''}" onclick="setAuth('register')">Create account</button></div>
    <div class="fields">${reg ? field('Name', '<input id="n" autocomplete="name" required>') : ''}${field('Email', '<input id="e" type="email" autocomplete="email" required>')}
      ${field('Password' + (reg ? ' (6+ characters)' : ''), `<input id="p" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" minlength="${reg ? 6 : 1}" required>`)}</div>
    <button style="width:100%">${reg ? 'Create account' : 'Log in'}</button></form></div>`;
}
window.setAuth = m => { authMode = m; authView(); };
window.auth = run(async ev => { ev.preventDefault(); me = await api('/api/' + authMode, { name: $('#n')?.value, email: $('#e').value, password: $('#p').value }); render(); });

// ---- new request ----
let mode = null, bill = null;
window.pickMode = m => { mode = m; bill = null; printView(); };
async function printView() {
  const canCsd = me.type === 'csd';
  $('#view').innerHTML = `<div class="card"><div class="ch"><span class="num">1</span><h2>What is this print for?</h2></div><div class="choices">
    <button class="choice ${mode === 'personal' ? 'sel' : ''}" onclick="pickMode('personal')">${ic('user')}<span><b>Personal</b><span class="mute">Pay by UPI QR. Admins approve after checking your payment.</span></span></button>
    <button class="choice ${mode === 'csd' ? 'sel' : ''} ${canCsd ? '' : 'dis'}" onclick="${canCsd ? "pickMode('csd')" : "toast('CSD projects are for CSD members. Ask an admin to mark your account as CSD, or choose Personal.', 'err')"}">${ic('users')}<span><b>CSD project</b><span class="mute">${canCsd ? 'Free for CSD members. Admins approve.' : 'CSD members only.'}</span></span></button></div></div>
    <div id="step2"></div><div id="quote"></div>`;
  if (!mode) return;
  const [printers, s, o, projects] = await Promise.all([me.is_admin ? api('/api/printers') : [], api('/api/settings'), api('/api/options'), api('/api/projects')]);
  $('#step2').innerHTML = `<div class="card"><div class="ch"><span class="num">2</span><h2>Upload the part and set print parameters</h2></div>
    ${mode === 'csd' ? `<div class="fields">${field('Project', `<select id="cp">${projects.length ? projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('') : `<option value="">${me.is_admin ? 'No projects yet - add one under Admin > CSD projects' : 'No projects yet - ask an admin to add one'}</option>`}</select>`)}
      ${field('Part name', '<input id="cn" maxlength="120" placeholder="e.g. Sensor bracket">')}</div>
      <div class="fields" style="grid-template-columns:1fr">${field('Description', '<textarea id="cd" rows="2" maxlength="1000" placeholder="Describe the part and what it is for"></textarea>')}</div>` : ''}
    <label class="drop"><input type="file" id="f" accept=".stl,.3mf" hidden onchange="$('#fn').textContent=this.files[0]?this.files[0].name:'Choose your .stl file';$('.dz').classList.toggle('on',!!this.files[0])">
      <span class="dz">${ic('upload')}<b id="fn">Choose your .stl file</b><small>Tap to browse. A sliced .3mf from Bambu Studio also works and gives exact numbers. Max ${o.build_limit} mm per side.</small></span></label>
    <div class="fields">${field('Material', `<select id="pm">${o.materials.map(m => `<option>${m}</option>`).join('')}</select>`)}
      ${field('Layer height (mm)', '<select id="pl"><option>0.12</option><option>0.16</option><option selected>0.20</option><option>0.24</option><option>0.28</option></select>')}
      ${field('Infill (%)', '<input id="pi" type="number" min="0" max="100" value="15" inputmode="numeric">')}
      ${field('Copies', '<input id="pc" type="number" min="1" max="20" value="1" inputmode="numeric">')}
      ${me.is_admin ? field('Printer', `<select id="pp"><option value="">Least busy</option>${printers.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>`) : ''}</div>
    <label class="chk"><input type="checkbox" id="ps"> Needs supports</label>
    <p class="mute small" style="margin-top:12px">Rate: ${money(s.rate_per_gram)}/g + ${money(s.rate_per_hour)}/hour, minimum ${money(s.min_price)}. Extra parameter changes: contact the admins and come to CSD.</p>
    <button onclick="getBill()">${ic('gauge', 'sm')} Get estimate</button></div>`;
}
window.getBill = run(async () => {
  const f = $('#f').files[0]; if (!f) throw new Error('Choose a file');
  if (bill) { await api(`/api/jobs/${bill.id}/cancel`, {}); bill = null; }
  const fd = new FormData();
  fd.append('file', f); fd.append('mode', mode); fd.append('material', $('#pm').value); fd.append('layer', $('#pl').value); fd.append('infill', $('#pi').value);
  fd.append('copies', $('#pc').value); fd.append('supports', $('#ps').checked); if (me.is_admin) fd.append('printer_id', $('#pp').value);
  if (mode === 'csd') { fd.append('project_id', $('#cp').value); fd.append('part_name', $('#cn').value); fd.append('description', $('#cd').value); }
  bill = await api('/api/jobs', fd, true);
  const csd = bill.user_type === 'csd', q = csd ? null : await api(`/api/jobs/${bill.id}/qr`);
  $('#quote').innerHTML = `<div class="card"><div class="ch"><span class="num">3</span><h2>Bill</h2></div>
    <p><b>${esc(bill.part_name || bill.file_name)}</b>${bill.part_name ? ` <span class="mute">(${esc(bill.file_name)})</span>` : ''}${bill.description ? `<br><span class="mute">${esc(bill.description)}</span>` : ''}<br>
      <span class="mute small">${esc(bill.material)} · ${bill.layer} mm · ${bill.infill}% infill · ${bill.copies} ${bill.copies > 1 ? 'copies' : 'copy'} · ${bill.supports ? 'with' : 'no'} supports</span></p>
    <div class="bill"><div class="stat"><small>Estimated weight</small><b>${bill.grams.toFixed(1)} g</b>${bill.exact ? '' : ' <small>estimate</small>'}</div>
      <div class="stat"><small>Estimated time</small><b>${dur(bill.minutes)}</b></div>
      <div class="stat"><small>Cost</small><b>${money(bill.price)}</b>${csd ? '<small>not charged (CSD project)</small>' : ''}</div></div>
    ${csd ? '' : `<div class="ch" style="margin-top:18px"><span class="num">4</span><h2>Pay with the QR code</h2></div>
      <div class="qrbox"><img src="${q.qr}" alt="UPI QR code"><div>${field('Amount to pay', `<b style="font-size:24px;color:var(--ink)">${money(q.amount)}</b>`)}<p class="mute small" style="margin-top:8px">Scan with any UPI app and pay exactly this amount, or pay to <b>${esc(q.upi_id)}</b>.</p></div></div>
      <div class="ch"><span class="num">5</span><h2>Upload the transaction proof</h2></div>
      <label class="drop"><input type="file" id="proof" accept="image/*,.pdf" hidden onchange="$('#pn').textContent=this.files[0]?this.files[0].name:'Choose the payment screenshot';$('#pdz').classList.toggle('on',!!this.files[0])">
        <span class="dz" id="pdz">${ic('clip')}<b id="pn">Choose the payment screenshot</b><small>Image or PDF</small></span></label>
      <div class="fields">${field('UPI transaction ID (optional)', '<input id="txn" autocomplete="off">')}</div>`}
    <div class="row"><button class="ok" onclick="submitReq()">${ic('check', 'sm')} ${csd ? 'Submit request' : '6. Submit request'}</button><button class="alt" onclick="cancelBill()">Cancel</button></div>
    <p class="mute small">Admins are notified, then check material, schedule and print parameters before approving.</p></div>`;
  $('#quote').scrollIntoView({ behavior: 'smooth' });
});
window.cancelBill = run(async () => { if (bill) await api(`/api/jobs/${bill.id}/cancel`, {}); bill = null; $('#quote').innerHTML = ''; });
window.submitReq = run(async () => {
  const fd = new FormData(), p = $('#proof');
  if (p) { if (!p.files[0]) throw new Error('Upload the payment screenshot first'); fd.append('proof', p.files[0]); fd.append('txn_id', $('#txn').value); }
  await api(`/api/jobs/${bill.id}/submit`, fd, true); bill = null; mode = null;
  toast('Request submitted. The admins have been notified; you will get a notification when it is approved.'); go('hist');
});

// ---- job lists ----
const thumb = j => `<div class="th" onclick="bigPic(${j.id})"><img src="/api/jobs/${j.id}/thumb" loading="lazy" alt="" onerror="this.parentNode.classList.add('none');this.remove()">${ic('box')}</div>`;
window.bigPic = id => { const o = document.createElement('div'); o.className = 'ov'; o.onclick = () => o.remove(); o.innerHTML = `<img src="/api/jobs/${id}/thumb" alt="" onerror="this.remove()">`; document.body.appendChild(o); };
const jobsTable = (jobs, adm) => !jobs.length ? empty('inbox', 'Nothing here yet.') : `<div class="tbl"><table class="stack"><thead><tr><th></th><th>#</th><th>When</th>${adm ? '<th>User</th>' : ''}<th>Printer</th><th>Part</th><th>Weight</th><th>Type</th><th>Price</th><th>Payment</th><th>Status</th><th></th></tr></thead><tbody>${jobs.map(j => `<tr>
  <td data-label="">${thumb(j)}</td><td data-label="Request">#${j.id}</td><td data-label="When">${esc(j.created.slice(0, 16))}</td>${adm ? `<td data-label="User">${esc(j.user_name)}</td>` : ''}<td data-label="Printer">${esc(j.printer)}</td>
  <td data-label="Part">${j.project ? `<span class="pill">${esc(j.project)}</span> ` : ''}${esc(j.part_name || j.file_name)}${j.material ? `<br><span class="mute small">${esc(j.material)} · ${j.layer}mm · ${j.infill}%${j.copies > 1 ? ' · x' + j.copies : ''}</span>` : ''}</td>
  <td data-label="Weight">${j.grams.toFixed(1)} g</td><td data-label="Type">${j.user_type === 'csd' ? 'CSD' : 'Personal'}</td><td data-label="Price">${j.user_type === 'csd' ? 'Free' : money(j.price)}</td>
  <td data-label="Payment">${esc(j.txn_id || '–')}${j.has_proof ? ` <a href="/api/jobs/${j.id}/proof" target="_blank">proof</a>` : ''}</td>
  <td data-label="Status"><span>${tag(j.status)}${j.note ? `<br><span class="mute small">${esc(j.note)}</span>` : ''}${j.scheduled ? `<br><span class="mute small">${ic('calendar', 'sm')} ${esc(j.scheduled.replace('T', ' '))} · ${j.print_mode === 'manual' ? 'manual print' : 'site prints'}</span>` : ''}</span></td>
  <td class="act" data-label="">${adm ? actions(j) : j.status === 'submitted' ? `<button class="alt sm" onclick="cancelSub(${j.id})">Cancel</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
const actions = j => ({
  submitted: `<button class="ok sm" onclick="reviewJob(${j.id})">Review</button>`,
  queued: `<button class="sm" onclick="act(${j.id},'start')">${ic('play', 'sm')} ${j.print_mode === 'manual' ? 'Mark printing' : 'Start'}</button><button class="alt sm" onclick="openStudio(${j.id})" title="Opens the uploaded file in Bambu Studio on the server laptop; set it up and press Print there">Open in Bambu Studio</button><button class="alt sm" onclick="studio(${j.id})" title="Download the uploaded file to open in Bambu Studio on this PC">Download</button><button class="bad sm" onclick="act(${j.id},'reject')">Reject</button>`,
  printing: `<button class="ok sm" onclick="act(${j.id},'done')">Done</button><button class="bad sm" onclick="act(${j.id},'failed')">Failed</button>`,
})[j.status] || '';
window.cancelSub = run(async id => { if (!confirm('Cancel this request?')) return; await api(`/api/jobs/${id}/cancel`, {}); histView(); });
window.act = run(async (id, a) => {
  const note = a === 'reject' ? prompt('Reason?') || '' : '';
  if (a === 'start') toast('Preparing the print (slicing and sending to the printer can take a minute)...');
  await api(`/api/admin/jobs/${id}/${a}`, { note });
  if (a === 'start') toast(`Job #${id} started`);
  adminView();
});

// The uploaded file for printing by hand in Bambu Studio; the print is linked to the job when it starts on the printer
window.studio = run(async id => {
  const r = await fetch(`/api/admin/jobs/${id}/project`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not prepare the file');
  const cd = r.headers.get('Content-Disposition') || '';
  const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] || '') || /filename="([^"]+)"/.exec(cd)?.[1] || `PrintLab-${id}`;
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Downloaded. Open it in Bambu Studio, set it up and press Print. The job turns to Printing on its own.');
});

window.openStudio = run(async id => {
  await api(`/api/admin/jobs/${id}/studio`, {});
  toast('Opened in Bambu Studio on the server laptop. Set it up and press Print there.');
});

window.reviewJob = run(async id => {
  const [jobs, printers, o] = await Promise.all([api('/api/admin/jobs'), api('/api/printers'), api('/api/options')]), j = jobs.find(x => x.id === id);
  const m = document.createElement('div'); m.className = 'ov modal';
  m.innerHTML = `<div class="mbox"><div class="mh"><h2>Review request #${j.id}</h2><button class="plain" onclick="this.closest('.modal').remove()" aria-label="Close">${ic('x')}</button></div>
    <div class="row" style="align-items:flex-start">${thumb(j)}<div><b>${esc(j.part_name || j.file_name)}</b>${j.project ? ` <span class="pill">${esc(j.project)}</span>` : ''}<br>${j.description ? `<span>${esc(j.description)}</span><br>` : ''}
      <span class="mute small">${esc(j.file_name)} · ${esc(j.user_name)} · ${j.user_type === 'csd' ? 'CSD project' : 'Personal'} · ${j.grams.toFixed(1)} g · ${dur(j.minutes)}${j.exact ? '' : ' (estimate)'}${j.geo ? ' · part ' + JSON.parse(j.geo).map(Math.round).join('x') + ' mm' : ''}</span></div></div>
    ${j.user_type === 'csd' ? '' : `<div class="card" style="box-shadow:none;margin:12px 0"><div class="ch" style="margin-bottom:8px">${ic('wallet')}<h2>Payment</h2></div>Billed <b>${money(j.price)}</b> · transaction ID <b>${esc(j.txn_id || 'not given')}</b>
      ${j.has_proof ? `<div style="margin-top:8px"><a href="/api/jobs/${j.id}/proof" target="_blank"><img class="proof" src="/api/jobs/${j.id}/proof" alt="Payment proof" onerror="this.replaceWith(document.createTextNode('Open proof'))"></a></div>` : ''}
      <p class="mute small" style="margin:8px 0 0">Check the amount in your bank / UPI app before approving.</p></div>`}
    <div class="fields">${field('Printer', `<select id="rp">${printers.map(p => `<option value="${p.id}" ${p.id === j.printer_id ? 'selected' : ''}>${esc(p.name)} (${p.queue} queued)</option>`).join('')}</select>`)}
      ${field('Material', `<select id="rm">${o.materials.map(x => `<option ${x === j.material ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}
      ${field('Layer (mm)', `<input id="rl" type="number" step="0.01" value="${j.layer ?? 0.2}">`)}${field('Infill (%)', `<input id="ri" type="number" value="${j.infill ?? 15}">`)}
      ${field('Schedule', '<input id="rs" type="datetime-local">')}</div>
    <div class="row"><label class="chk"><input type="checkbox" id="rsup" ${j.supports ? 'checked' : ''}> Supports</label><label class="chk"><input type="checkbox" id="rok"> <b>Material available</b></label></div>
    <div class="row"><b>Print:</b><label class="chk"><input type="radio" name="rpm" value="auto" checked> Site prints directly</label><label class="chk"><input type="radio" name="rpm" value="manual"> Manually on the printer</label></div>
    <div class="fields" style="grid-template-columns:1fr">${field('Note to the user / reason if rejecting', '<input id="rn">')}</div>
    <div class="row"><button class="ok" onclick="decide(${j.id},'approve')">${ic('check', 'sm')} Approve</button><button class="bad" onclick="decide(${j.id},'reject')">${ic('x', 'sm')} Reject</button><button class="alt" onclick="this.closest('.modal').remove()">Close</button></div></div>`;
  document.body.appendChild(m);
});
window.decide = run(async (id, decision) => {
  await api(`/api/admin/jobs/${id}/review`, { decision, printer_id: $('#rp').value, material: $('#rm').value, layer: $('#rl').value, infill: $('#ri').value, supports: $('#rsup').checked,
    scheduled: $('#rs').value, print_mode: document.querySelector('input[name=rpm]:checked').value, material_ok: $('#rok').checked, admin_note: $('#rn').value });
  document.querySelector('.modal').remove(); toast(decision === 'approve' ? 'Request approved' : 'Request rejected'); adminView();
});

// ---- live printers ----
const speedName = n => ({ 1: 'Silent', 2: 'Standard', 3: 'Sport', 4: 'Ludicrous' })[n] || '–';
const temp = v => v != null ? Math.round(v) + ' °C' : '–';
const liveCard = p => {
  const l = p.live, st = !l ? 'not linked' : !l.online ? 'offline' : l.state === 'RUNNING' ? 'printing' : l.state === 'PAUSE' ? 'paused' : l.state === 'FINISH' ? 'finished' : l.state === 'FAILED' ? 'failed' : 'idle';
  const row = (i, k, v) => `<span class="k">${ic(i, 'sm')}${k}</span><span class="v">${v}</span>`;
  const body = !l || !l.online ? `<p class="mute">${l?.error ? esc(l.error) : 'No data yet. An admin needs to add the printer connection details.'}</p>` : `
    ${l.state === 'RUNNING' || l.state === 'PAUSE' ? `<div class="pct">${l.percent ?? '?'}%</div><div class="bar"><i style="width:${l.percent || 0}%"></i></div><p class="mute">${l.remaining_min != null ? dur(l.remaining_min) + ' left' : ''}</p>` : ''}
    <div class="kv">${row('file', 'File', esc(l.file || l.gcode_file || '–'))}${row('layers', 'Layer', `${l.layer ?? '–'} / ${l.total_layers ?? '–'}`)}${row('thermo', 'Nozzle', temp(l.nozzle))}${row('thermo', 'Bed', temp(l.bed))}
      ${row('thermo', 'Chamber', temp(l.chamber))}${row('gauge', 'Speed', speedName(l.speed))}${row('wifi', 'Wi‑Fi', esc(l.wifi || '–'))}${l.errors ? row('alert', 'Warnings', `<span class="err">${l.errors} active</span>`) : ''}</div>`;
  return `<div class="card"><div class="ch">${ic('printer')}<h2>${esc(p.name)}</h2>${tag(st)}<span class="sub">${p.queue} in queue</span></div>${body}</div>`;
};
async function liveView() {
  const draw = async () => { const ps = await api('/api/printers'), el = $('#live'); if (el) el.innerHTML = ps.map(liveCard).join(''); };
  $('#view').innerHTML = '<div id="live" class="choices" style="grid-template-columns:repeat(auto-fit,minmax(290px,1fr));align-items:start"></div><p class="mute small">Updates every 5 seconds.</p>';
  await draw(); window.liveTimer = setInterval(() => draw().catch(() => {}), 5000);
}

// ---- log & history ----
const took = (a, b) => { if (!a) return '–'; const m = ((b ? new Date(b.replace(' ', 'T') + 'Z') : new Date()) - new Date(a.replace(' ', 'T') + 'Z')) / 60000; return m < 1 ? '<1m' : dur(m); };
async function logView() {
  const jobs = await api('/api/printer-log');
  $('#view').innerHTML = `<div class="card"><div class="ch">${ic('list')}<h2>Printer log</h2><span class="sub">Everything the printers ran</span></div>
    ${jobs.length ? `<div class="tbl"><table class="stack"><thead><tr><th></th><th>Started</th><th>Printer</th><th>Part</th><th>Who</th><th>Filament</th><th>Took</th><th>Status</th></tr></thead><tbody>${jobs.map(j => `<tr>
      <td data-label="">${thumb(j)}</td><td data-label="Started">${esc((j.started || j.created).slice(0, 16))}</td><td data-label="Printer">${esc(j.printer)}</td><td data-label="Part">${esc(j.part_name || j.file_name)}</td>
      <td data-label="Who">${esc(j.user_name)}${j.source === 'printer' ? ' <span class="pill">direct</span>' : ''}</td><td data-label="Filament">${j.grams ? j.grams.toFixed(1) + ' g' : '–'}</td>
      <td data-label="Took">${took(j.started, j.finished)}</td><td data-label="Status"><span>${tag(j.status)}${j.note ? `<br><span class="mute small">${esc(j.note)}</span>` : ''}</span></td></tr>`).join('')}</tbody></table></div>` : empty('printer', 'Nothing printed yet.')}</div>`;
}
async function histView() { $('#view').innerHTML = `<div class="card"><div class="ch">${ic('clock')}<h2>My requests</h2></div>${jobsTable(await api('/api/jobs'))}</div>`; }

// ---- admin ----
const SET = { rate_per_gram: ['Rate per gram (₹)', 'number'], rate_per_hour: ['Rate per hour (₹)', 'number'], min_price: ['Minimum price (₹)', 'number'], upi_id: ['UPI ID for payments', 'text'], payee: ['Payee name (shown in the UPI app)', 'text'], csd_gram_limit: ['CSD limit per job (g, 0 = none)', 'number'],
  slicer_path: ['Bambu Studio path (empty = C:\\Program Files\\Bambu Studio\\bambu-studio.exe)', 'text'], use_ams: ['Feed filament from the AMS (1 = yes, 0 = external spool)', 'number'] };
async function adminView() {
  const [printers, projects, jobs, users, stats, s] = await Promise.all([api('/api/printers'), api('/api/projects'), api('/api/admin/jobs'), api('/api/admin/users'), api('/api/admin/stats'), api('/api/settings')]);
  const pending = jobs.filter(j => j.status === 'submitted');
  $('#view').innerHTML = `${pending.length ? `<div class="card warn"><div class="ch">${ic('inbox')}<h2>Requests to review</h2><span class="badge submitted">${pending.length} waiting</span></div>${jobsTable(pending, true)}</div>` : ''}
    <div class="card"><div class="ch">${ic('gauge')}<h2>Totals</h2><span class="sub">Completed prints</span></div><div class="tbl"><table class="stack"><thead><tr><th>Printer</th><th>Jobs</th><th>Filament (g)</th><th>CSD (g, free)</th><th>Hours</th><th>Money</th></tr></thead><tbody>
      ${stats.map(r => `<tr><td data-label="Printer"><b>${r.printer}</b></td><td data-label="Jobs">${r.jobs}</td><td data-label="Filament (g)">${r.grams}</td><td data-label="CSD (g, free)">${r.csd_grams}</td><td data-label="Hours">${r.hours}</td><td data-label="Money">${money(r.money)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><div class="ch">${ic('list')}<h2>All requests</h2></div>${jobsTable(jobs, true)}</div>
    <div class="card"><div class="ch">${ic('users')}<h2>Users</h2><span class="sub">CSD members print free</span></div><div class="tbl"><table class="stack"><thead><tr><th>Name</th><th>Email</th><th>Type</th><th>Admin</th></tr></thead><tbody>${users.map(u => `<tr><td data-label="Name">${esc(u.name)}</td><td data-label="Email">${esc(u.email)}</td>
      <td data-label="Type"><select style="width:auto" onchange="setUser(${u.id},{type:this.value})"><option value="individual" ${u.type === 'individual' ? 'selected' : ''}>Individual</option><option value="csd" ${u.type === 'csd' ? 'selected' : ''}>CSD</option></select></td>
      <td data-label="Admin"><input type="checkbox" class="switch" ${u.is_admin ? 'checked' : ''} onchange="setUser(${u.id},{is_admin:this.checked})"></td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><div class="ch">${ic('layers')}<h2>CSD projects</h2></div><p class="mute small">CSD members pick one of these when they submit a project request.</p>
      <div class="row">${projects.map(p => `<span class="pill">${esc(p.name)}<button onclick="rmProject(${p.id})" title="Remove" aria-label="Remove ${esc(p.name)}">${ic('x', 'sm')}</button></span>`).join('') || '<span class="mute">No projects yet.</span>'}</div>
      <div class="row"><input id="np" placeholder="New project name" style="max-width:300px"><button onclick="addProject()">${ic('plus', 'sm')} Add project</button></div></div>
    <div class="card"><div class="ch">${ic('link')}<h2>Printer connections</h2></div><p class="mute small">Turn on LAN Mode on the printer. The IP address, access code and serial number are on the printer's network and device screens.</p>
      ${printers.map(p => `<div class="card" style="box-shadow:none;margin-bottom:10px"><div class="ch" style="margin-bottom:10px">${ic('printer')}<h2>${esc(p.name)}</h2>${liveTag(p)}</div>
        <div class="fields">${field('IP address', `<input id="ip${p.id}" value="${esc(p.ip || '')}" placeholder="10.100.x.x">`)}${field('Serial number', `<input id="sn${p.id}" value="${esc(p.serial || '')}">`)}
          ${field('Access code', `<input id="ac${p.id}" placeholder="${p.has_code ? 'Saved (leave empty to keep)' : '8 characters'}">`)}</div>
        <div class="row"><button onclick="savePrinter(${p.id})">${ic('link', 'sm')} Connect</button><button class="alt" onclick="rawData(${p.id})">Raw data</button><button class="alt" onclick="ftpFiles(${p.id})">Check files</button>${p.live?.error ? `<span class="err small">${esc(p.live.error)}</span>` : ''}</div></div>`).join('')}</div>
    <div class="card"><div class="ch">${ic('sliders')}<h2>Settings</h2></div><div class="fields">${Object.keys(s).map(k => field(SET[k]?.[0] || k, `<input id="s_${k}" type="${SET[k]?.[1] || 'text'}" step="any" value="${esc(s[k])}">`)).join('')}</div>
      <button onclick="saveSettings(${JSON.stringify(Object.keys(s)).replace(/"/g, '&quot;')})">${ic('check', 'sm')} Save settings</button></div>`;
}
window.savePrinter = run(async id => { await api('/api/admin/printers/' + id, { ip: $('#ip' + id).value, serial: $('#sn' + id).value, access_code: $('#ac' + id).value }); setTimeout(adminView, 3000); toast('Saved. Connecting to the printer...'); });
window.rawData = run(async id => { const d = await api(`/api/admin/printers/${id}/raw`); const w = window.open('', '_blank'); w.document.write('<pre>' + esc(JSON.stringify(d, null, 2)) + '</pre>'); });
window.ftpFiles = run(async id => { const w = window.open('', '_blank'); w.document.write('Checking printer files...'); try { const d = await api(`/api/admin/printers/${id}/files`); w.document.body.innerHTML = '<pre>' + esc(JSON.stringify(d, null, 2)) + '</pre>'; } catch (e) { w.document.body.innerHTML = '<pre>Error: ' + esc(e.message) + '</pre>'; } });
window.addProject = run(async () => { await api('/api/admin/projects', { name: $('#np').value }); adminView(); });
window.rmProject = run(async id => { if (confirm('Remove this project from the list? Existing requests keep it.')) { await api(`/api/admin/projects/${id}/remove`, {}); adminView(); } });
window.setUser = run(async (id, b) => { await api('/api/admin/users/' + id, b); toast('User updated'); });
window.saveSettings = run(async keys => { await api('/api/admin/settings', Object.fromEntries(keys.map(k => [k, $('#s_' + k).value]))); toast('Settings saved'); });

init();
