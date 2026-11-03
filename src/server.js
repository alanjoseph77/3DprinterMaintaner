const fs0 = require('node:fs');
if (fs0.existsSync('.env')) for (const l of fs0.readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { db, settings } = require('./db');
const slice = require('./slice');
const driver = require('./printer');
const bambu = require('./bambu');
const { MATERIALS, BUILD_LIMIT, parseStl, checkParams, estimate } = require('./estimate');

fs.mkdirSync('uploads', { recursive: true });
const upload = multer({ dest: 'uploads/', limits: { fileSize: 100 * 1024 * 1024 } });
const app = express();
app.use(express.json());
app.use(express.static('public'));

const hash = (p, salt = crypto.randomBytes(8).toString('hex')) => salt + ':' + crypto.scryptSync(p, salt, 32).toString('hex');
const check = (p, h) => { const [s] = h.split(':'); const a = Buffer.from(hash(p, s)), b = Buffer.from(h); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const wrap = fn => (req, res) => Promise.resolve().then(() => fn(req, res)).catch(e => res.status(400).json({ error: e.message }));

// ---- auth ----
app.use((req, _res, next) => {
  const t = /(?:^|; )token=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  req.user = t ? db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(t) : null;
  next();
});
const auth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Login required' });
const admin = (req, res, next) => req.user?.is_admin ? next() : res.status(403).json({ error: 'Admin only' });
const login = (res, id) => {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?)').run(token, id);
  res.setHeader('Set-Cookie', `token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
};
const pub = u => u && { id: u.id, name: u.name, email: u.email, type: u.type, is_admin: !!u.is_admin };

app.post('/api/register', wrap((req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6) throw new Error('Name, email and a 6+ char password are required');
  const r = db.prepare('INSERT INTO users(name,email,pass,is_admin) VALUES(?,?,?,?)').run(name, email.toLowerCase(), hash(password), 0);
  login(res, r.lastInsertRowid);
  res.json(pub(db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid)));
}));
app.post('/api/login', wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get((req.body.email || '').toLowerCase());
  if (!u || !check(req.body.password || '', u.pass)) throw new Error('Wrong email or password');
  login(res, u.id); res.json(pub(u));
}));
app.post('/api/logout', (req, res) => { const t = /token=([^;]+)/.exec(req.headers.cookie || '')?.[1]; if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(t); res.json({}); });
app.get('/api/me', (req, res) => res.json(pub(req.user)));

// ---- printers / settings ----
app.get('/api/printers', auth, (req, res) => res.json(db.prepare(`
  SELECT p.id,p.name,p.status,p.ip,p.serial,(p.access_code IS NOT NULL AND p.access_code<>'') has_code,
    (SELECT COUNT(*) FROM jobs j WHERE j.printer_id=p.id AND j.status IN ('queued','printing')) queue FROM printers p`).all()
  .map(p => ({ ...p, ip: req.user.is_admin ? p.ip : undefined, serial: req.user.is_admin ? p.serial : undefined, live: bambu.info(p.id) }))));
app.get('/api/admin/printers/:id/files', auth, admin, wrap(async (req, res) => res.json(await bambu.diagnose(+req.params.id))));
app.get('/api/admin/printers/:id/raw', auth, admin, (req, res) => res.json(bambu.raw(+req.params.id) || {}));
app.post('/api/admin/printers/:id', auth, admin, wrap((req, res) => {
  const { ip, serial, access_code } = req.body;
  db.prepare('UPDATE printers SET ip=?,serial=?,access_code=COALESCE(NULLIF(?,\'\'),access_code) WHERE id=?').run((ip || '').trim(), (serial || '').trim(), (access_code || '').trim(), req.params.id);
  bambu.connect(db.prepare('SELECT * FROM printers WHERE id=?').get(req.params.id));
  res.json({});
}));
app.get('/api/settings', auth, (req, res) => { const s = settings(); res.json(req.user.is_admin ? s : { rate_per_gram: s.rate_per_gram, rate_per_hour: s.rate_per_hour, min_price: s.min_price }); });

// ---- jobs ----
const price = (grams, minutes, s) => Math.max(+s.min_price, grams * +s.rate_per_gram + (minutes / 60) * +s.rate_per_hour);
const notify = (userId, text, jobId) => db.prepare('INSERT INTO notifications(user_id,text,job_id) VALUES(?,?,?)').run(userId, text, jobId || null);
const notifyAdmins = (text, jobId) => db.prepare('SELECT id FROM users WHERE is_admin=1').all().forEach(a => notify(a.id, text, jobId));
const rm = f => { try { fs.unlinkSync(f); } catch {} };

app.get('/api/projects', auth, (_req, res) => res.json(db.prepare('SELECT id,name FROM projects WHERE active=1 ORDER BY name').all()));
app.post('/api/admin/projects', auth, admin, wrap((req, res) => {
  const name = String(req.body.name || '').trim(); if (!name) throw new Error('Enter a project name');
  db.prepare('INSERT INTO projects(name) VALUES(?) ON CONFLICT(name) DO UPDATE SET active=1').run(name); res.json({});
}));
app.post('/api/admin/projects/:id/remove', auth, admin, (req, res) => { db.prepare('UPDATE projects SET active=0 WHERE id=?').run(req.params.id); res.json({}); });
app.get('/api/options', auth, (_req, res) => res.json({ materials: Object.keys(MATERIALS), build_limit: BUILD_LIMIT }));

// Steps 2-3: upload the part, set parameters, site estimates weight/time/cost
app.post('/api/jobs', auth, upload.single('file'), wrap((req, res) => {
  const f = req.file; if (!f) throw new Error('Choose a file');
  try {
    const mode = req.body.mode === 'csd' ? 'csd' : 'personal';
    if (mode === 'csd' && req.user.type !== 'csd') throw new Error('CSD project requests are for CSD members only. Ask an admin to mark your account as CSD, or choose Personal.');
    if (!/\.(3mf|stl)$/i.test(f.originalname)) throw new Error('Upload the part as an .stl file (or a sliced .3mf from Bambu Studio)');
    const p = checkParams(req.body);
    let project = null, partName = String(req.body.part_name || '').trim().slice(0, 120), desc = String(req.body.description || '').trim().slice(0, 1000);
    if (mode === 'csd') {
      project = db.prepare('SELECT id FROM projects WHERE id=? AND active=1').get(req.body.project_id);
      if (!project) throw new Error('Select the project');
      if (!partName) throw new Error('Enter the part name');
      if (!desc) throw new Error('Enter a short description of the part');
    }
    let info, geo = null;
    if (/\.3mf$/i.test(f.originalname)) info = slice(f.path, f.originalname);
    else { geo = parseStl(fs.readFileSync(f.path)); info = { ...estimate(geo, p), exact: 0 }; }
    const s = settings(), lim = +s.csd_gram_limit;
    if (mode === 'csd' && lim && info.grams > lim) throw new Error(`CSD jobs are limited to ${lim} g`);
    const printer = db.prepare('SELECT * FROM printers WHERE id=?').get(req.body.printer_id) ||
      db.prepare(`SELECT p.* FROM printers p ORDER BY (SELECT COUNT(*) FROM jobs j WHERE j.printer_id=p.id AND j.status IN ('queued','printing')) LIMIT 1`).get();
    const cost = Math.round(price(info.grams, info.minutes, s));   // CSD projects see the cost but are not charged
    const r = db.prepare(`INSERT INTO jobs(user_id,printer_id,file_name,file_path,grams,minutes,exact,price,user_type,status,material,layer,infill,supports,copies,geo,project_id,part_name,description)
      VALUES(?,?,?,?,?,?,?,?,?,'quoted',?,?,?,?,?,?,?,?,?)`).run(req.user.id, printer.id, f.originalname, f.path, info.grams, info.minutes, info.exact, cost,
      mode === 'csd' ? 'csd' : 'individual', p.material, p.layer, p.infill, p.supports ? 1 : 0, p.copies, geo ? JSON.stringify(geo.size) : null, project?.id ?? null, partName || null, desc || null);
    const id = Number(r.lastInsertRowid);
    if (info.thumb) fs.writeFileSync(`uploads/thumb_${id}.png`, info.thumb);
    if (mode === 'personal') db.prepare('UPDATE jobs SET price=? WHERE id=?').run(cost + (id % 99 + 1) / 100, id); // unique paise to match the payment
    const { file_path, ...out } = db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    res.json(out);
  } catch (e) { rm(f.path); throw e; }
}));

const mine = (req, res, next) => {
  const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!j || (j.user_id !== req.user.id && !req.user.is_admin)) return res.status(404).json({ error: 'Not found' });
  req.job = j; next();
};
const setStatus = (id, st, extra = '') => db.prepare(`UPDATE jobs SET status=?${extra} WHERE id=?`).run(st, id);

// pictures: lab-wide for prints that are running/finished, owner/admin only before that
app.get('/api/jobs/:id/thumb', auth, (req, res) => {
  const j = db.prepare("SELECT id FROM jobs WHERE id=? AND status IN ('queued','printing','done','failed')").get(req.params.id) ||
    db.prepare('SELECT id FROM jobs WHERE id=? AND (user_id=? OR ?=1)').get(req.params.id, req.user.id, req.user.is_admin ? 1 : 0);
  const f = j && `uploads/thumb_${j.id}.png`;
  if (!f || !fs.existsSync(f)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=86400'); res.sendFile(require('node:path').resolve(f));
});
// Step 4: bill with a QR code
app.get('/api/jobs/:id/qr', auth, mine, wrap(async (req, res) => {
  const s = settings(), j = req.job;
  const url = `upi://pay?pa=${encodeURIComponent(s.upi_id)}&pn=${encodeURIComponent(s.payee)}&am=${j.price.toFixed(2)}&cu=INR&tn=${encodeURIComponent('3D print #' + j.id)}`;
  res.json({ amount: j.price, upi_id: s.upi_id, qr: await QRCode.toDataURL(url, { width: 280 }) });
}));
// Steps 5-6: upload the transaction proof, submit the request; admins get notified
const proofUpload = multer({ dest: 'uploads/', limits: { fileSize: 8 * 1024 * 1024 } });
app.post('/api/jobs/:id/submit', auth, proofUpload.single('proof'), mine, wrap((req, res) => {
  const j = req.job, pf = req.file;
  try {
    if (j.status !== 'quoted') throw new Error('This request was already submitted');
    let txn = null;
    if (j.user_type === 'individual') {
      if (!pf) throw new Error('Upload the payment screenshot (transaction proof)');
      if (!/^(image\/|application\/pdf)/.test(pf.mimetype)) throw new Error('Proof must be an image or PDF');
      txn = (req.body.txn_id || '').trim() || null;
      if (txn && !/^[A-Za-z0-9]{8,30}$/.test(txn)) throw new Error('UPI transaction ID should be 8-30 letters/digits');
      if (txn && db.prepare('SELECT 1 FROM jobs WHERE txn_id=? AND id<>?').get(txn, j.id)) throw new Error('This transaction ID was already used');
    }
    let proof = null;
    if (pf) { proof = `proof_${j.id}${require('node:path').extname(pf.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')}`; fs.renameSync(pf.path, 'uploads/' + proof); }
    db.prepare("UPDATE jobs SET status='submitted',txn_id=?,proof_file=?,submitted=datetime('now') WHERE id=?").run(txn, proof, j.id);
    notifyAdmins(`New ${j.user_type === 'csd' ? 'CSD project' : 'personal'} request #${j.id} from ${req.user.name}: ${j.part_name || j.file_name}, ${j.grams.toFixed(1)} g${j.user_type === 'csd' ? '' : ', Rs ' + j.price.toFixed(2)}`, j.id);
    res.json({});
  } catch (e) { if (pf) rm(pf.path); throw e; }
}));
app.get('/api/jobs/:id/proof', auth, mine, (req, res) => {
  if (!req.job.proof_file) return res.status(404).end();
  res.sendFile(require('node:path').resolve('uploads', req.job.proof_file));
});
app.post('/api/jobs/:id/cancel', auth, mine, wrap((req, res) => {
  const j = req.job;
  if (j.status === 'quoted') { db.prepare('DELETE FROM jobs WHERE id=?').run(j.id); rm(j.file_path); rm(`uploads/thumb_${j.id}.png`); return res.json({}); }
  if (j.status !== 'submitted') throw new Error('Cannot cancel now');
  setStatus(j.id, 'rejected', ",note='Cancelled by user'"); res.json({});
}));

// notifications (bell)
app.get('/api/notifications', auth, (req, res) => res.json({
  unread: db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c,
  items: db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30').all(req.user.id),
}));
app.post('/api/notifications/read', auth, (req, res) => { db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id); res.json({}); });

const JOBS = `SELECT j.id,j.user_id,j.printer_id,j.file_name,j.grams,j.minutes,j.exact,j.price,j.user_type,j.status,j.txn_id,j.paid_amount,j.created,j.started,j.finished,j.note,j.source,j.material,j.layer,j.infill,j.supports,j.copies,j.geo,j.scheduled,j.print_mode,j.material_ok,j.admin_note,j.submitted,j.project_id,j.part_name,j.description,pr.name project,(j.proof_file IS NOT NULL) has_proof,COALESCE(u.name,'Direct print') user_name,u.email,p.name printer FROM jobs j LEFT JOIN users u ON u.id=j.user_id JOIN printers p ON p.id=j.printer_id LEFT JOIN projects pr ON pr.id=j.project_id`;
app.get('/api/jobs', auth, (req, res) => res.json(db.prepare(`${JOBS} WHERE j.user_id=? AND j.status<>'quoted' ORDER BY j.id DESC`).all(req.user.id)));

// ---- admin ----
// lab-wide log of everything the printers actually ran (site jobs + direct prints)
app.get('/api/printer-log', auth, (_req, res) => res.json(db.prepare(`${JOBS} WHERE j.status IN ('printing','done','failed') ORDER BY COALESCE(j.started,j.created) DESC LIMIT 300`).all()
  .map(({ email, txn_id, paid_amount, price, ...j }) => j)));
app.get('/api/admin/jobs', auth, admin, (_req, res) => res.json(db.prepare(`${JOBS} WHERE j.status<>'quoted' ORDER BY j.id DESC`).all()));
app.get('/api/admin/users', auth, admin, (_req, res) => res.json(db.prepare('SELECT id,name,email,type,is_admin FROM users ORDER BY id').all()));
app.post('/api/admin/users/:id', auth, admin, wrap((req, res) => {
  const { type, is_admin } = req.body;
  if (type) { if (!['csd', 'individual'].includes(type)) throw new Error('Bad type'); db.prepare('UPDATE users SET type=? WHERE id=?').run(type, req.params.id); }
  if (is_admin !== undefined) db.prepare('UPDATE users SET is_admin=? WHERE id=?').run(is_admin ? 1 : 0, req.params.id);
  res.json({});
}));
app.post('/api/admin/settings', auth, admin, wrap((req, res) => {
  for (const [k, v] of Object.entries(req.body)) if (k in settings()) db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(v), k);
  res.json(settings());
}));
// Steps 7-8: admin checks material, schedule and print parameters, then approves (site prints directly, or manual) or rejects
app.post('/api/admin/jobs/:id/review', auth, admin, wrap((req, res) => {
  const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!j || j.status !== 'submitted') throw new Error('This request is not waiting for review');
  const b = req.body, note = String(b.admin_note || '').trim();
  if (b.decision === 'reject') {
    db.prepare("UPDATE jobs SET status='rejected',note=?,admin_note=? WHERE id=?").run(note || 'Rejected by admin', note, j.id);
    notify(j.user_id, `Your request #${j.id} was rejected: ${note || 'no reason given'}`, j.id);
    return res.json({});
  }
  if (b.decision !== 'approve') throw new Error('Choose approve or reject');
  if (!b.material_ok) throw new Error('Tick "material available" after checking the stock');
  const p = checkParams({ ...j, ...b }), printer = db.prepare('SELECT * FROM printers WHERE id=?').get(b.printer_id);
  if (!printer) throw new Error('Choose a printer');
  if (!['auto', 'manual'].includes(b.print_mode)) throw new Error('Choose how it will be printed');
  db.prepare(`UPDATE jobs SET status='queued',printer_id=?,material=?,layer=?,infill=?,supports=?,scheduled=?,print_mode=?,material_ok=1,admin_note=?,
    paid_amount=CASE WHEN user_type='individual' THEN price ELSE 0 END WHERE id=?`)
    .run(printer.id, p.material, p.layer, p.infill, p.supports ? 1 : 0, b.scheduled || null, b.print_mode, note, j.id);
  notify(j.user_id, `Your request #${j.id} is approved: ${printer.name}${b.scheduled ? ', scheduled ' + String(b.scheduled).replace('T', ' ') : ''}, ${b.print_mode === 'auto' ? 'printed by the site' : 'printed manually'}.${note ? ' Note: ' + note : ''}`, j.id);
  res.json({});
}));
// Print by hand: the uploaded file goes into Bambu Studio (download, or opened on this PC); the admin prints from there
const approved = id => db.prepare("SELECT * FROM jobs WHERE id=? AND status IN ('queued','printing')").get(id) || (() => { throw new Error('Only approved jobs can be opened in Bambu Studio'); })();
app.get('/api/admin/jobs/:id/project', auth, admin, wrap((req, res) => { const { file, name } = driver.upload(approved(req.params.id)); res.download(require('node:path').resolve(file), name); }));
app.post('/api/admin/jobs/:id/studio', auth, admin, wrap((req, res) => { driver.openInStudio(approved(req.params.id)); res.json({}); }));
app.post('/api/admin/jobs/:id/:action', auth, admin, wrap(async (req, res) => {
  const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id); if (!j) throw new Error('Not found');
  const a = req.params.action, now = "datetime('now')";
  if (a === 'reject' && ['submitted', 'queued'].includes(j.status)) {
    db.prepare('UPDATE jobs SET status=?,note=? WHERE id=?').run('rejected', String(req.body.note || 'Rejected by admin'), j.id);
    if (j.user_id) notify(j.user_id, `Your request #${j.id} was rejected: ${req.body.note || 'no reason given'}`, j.id);
  } else if (a === 'start' && j.status === 'queued') {
    const p = db.prepare('SELECT * FROM printers WHERE id=?').get(j.printer_id);
    if (p.status === 'printing') throw new Error(`${p.name} is busy`);
    if (j.print_mode !== 'manual') await driver.start(p, j);   // manual jobs are started by hand on the printer
    db.prepare('UPDATE printers SET status=? WHERE id=?').run('printing', p.id);
    setStatus(j.id, 'printing', `,started=${now}`);
  } else if ((a === 'done' || a === 'failed') && j.status === 'printing') {
    db.prepare("UPDATE printers SET status='idle' WHERE id=?").run(j.printer_id);
    setStatus(j.id, a, `,finished=${now}`);
  } else throw new Error(`Cannot ${a} a job that is ${j.status}`);
  res.json({});
}));
app.get('/api/admin/stats', auth, admin, (_req, res) => res.json(db.prepare(`
  SELECT p.name printer, COUNT(j.id) jobs, ROUND(COALESCE(SUM(j.grams),0),1) grams,
    ROUND(COALESCE(SUM(CASE WHEN j.user_type='individual' THEN j.paid_amount END),0),2) money,
    ROUND(COALESCE(SUM(CASE WHEN j.user_type='csd' THEN j.grams END),0),1) csd_grams,
    ROUND(COALESCE(SUM((julianday(j.finished)-julianday(j.started))*24),0),2) hours
  FROM printers p LEFT JOIN jobs j ON j.printer_id=p.id AND j.status='done' GROUP BY p.id`).all()));

// Fixed admin account: created/reset on every start from ADMIN_EMAIL / ADMIN_PASSWORD (.env or environment)
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@printlab.local').toLowerCase(), ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
{
  const u = db.prepare('SELECT id FROM users WHERE email=?').get(ADMIN_EMAIL);
  if (u) db.prepare('UPDATE users SET pass=?,is_admin=1 WHERE id=?').run(hash(ADMIN_PASSWORD), u.id);
  else db.prepare('INSERT INTO users(name,email,pass,is_admin,type) VALUES(?,?,?,1,\'csd\')').run('Admin', ADMIN_EMAIL, hash(ADMIN_PASSWORD));
  if (require.main === module && ADMIN_PASSWORD === 'admin123') console.warn('WARNING: using the default admin password. Set ADMIN_PASSWORD in a .env file.');
}
const port = process.env.PORT || 3000;
if (require.main === module) bambu.start();
if (require.main === module) app.listen(port, () => console.log(`Print Lab running: http://localhost:${port}`)).on('error', e => { console.error('Could not start server:', e.message); process.exit(1); });
module.exports = app;
