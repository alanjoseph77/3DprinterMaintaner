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

app.post('/api/jobs', auth, upload.single('file'), wrap((req, res) => {
  const f = req.file; if (!f) throw new Error('Choose a file');
  const printer = db.prepare('SELECT * FROM printers WHERE id=?').get(req.body.printer_id);
  if (!printer) throw new Error('Choose a printer');
  if (!/\.(3mf|stl)$/i.test(f.originalname)) { fs.unlinkSync(f.path); throw new Error('Only .3mf or .stl files'); }
  let info; try { info = slice(f.path, f.originalname); } catch (e) { fs.unlinkSync(f.path); throw e; }
  const s = settings(), csd = req.user.type === 'csd';
  const lim = +s.csd_gram_limit;
  if (csd && lim && info.grams > lim) throw new Error(`CSD jobs are limited to ${lim} g`);
  let p = 0;
  if (!csd) { p = Math.round(price(info.grams, info.minutes, s)); }
  const r = db.prepare(`INSERT INTO jobs(user_id,printer_id,file_name,file_path,grams,minutes,exact,price,user_type,status) VALUES(?,?,?,?,?,?,?,?,?,'quoted')`)
    .run(req.user.id, printer.id, f.originalname, f.path, info.grams, info.minutes, info.exact, p, req.user.type);
  const id = Number(r.lastInsertRowid);
  if (info.thumb) fs.writeFileSync(`uploads/thumb_${id}.png`, info.thumb);
  if (!csd) db.prepare('UPDATE jobs SET price=? WHERE id=?').run(p + (id % 99 + 1) / 100, id); // unique paise to match the payment
  const { file_path, ...out } = db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  res.json(out);
}));

const mine = (req, res, next) => {
  const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!j || (j.user_id !== req.user.id && !req.user.is_admin)) return res.status(404).json({ error: 'Not found' });
  req.job = j; next();
};
const setStatus = (id, st, extra = '') => db.prepare(`UPDATE jobs SET status=?${extra} WHERE id=?`).run(st, id);

app.post('/api/jobs/:id/confirm', auth, mine, wrap((req, res) => {
  if (req.job.status !== 'quoted') throw new Error('Already confirmed');
  setStatus(req.job.id, req.job.user_type === 'csd' ? 'queued' : 'pending_payment');
  res.json({});
}));
// every logged-in user may see pictures of prints that ran on the printers (the log is lab-wide)
app.get('/api/jobs/:id/thumb', auth, (req, res) => {
  const j = db.prepare("SELECT id FROM jobs WHERE id=? AND status NOT IN ('quoted','pending_payment','rejected')").get(req.params.id) || db.prepare('SELECT id FROM jobs WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!j) return res.status(404).end();
  const f = `uploads/thumb_${j.id}.png`;
  if (!fs.existsSync(f)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=86400'); res.sendFile(require('node:path').resolve(f));
});
app.get('/api/jobs/:id/qr', auth, mine, wrap(async (req, res) => {
  const s = settings(), j = req.job;
  const url = `upi://pay?pa=${encodeURIComponent(s.upi_id)}&pn=${encodeURIComponent(s.payee)}&am=${j.price.toFixed(2)}&cu=INR&tn=${encodeURIComponent('3D print #' + j.id)}`;
  res.json({ amount: j.price, upi_id: s.upi_id, qr: await QRCode.toDataURL(url, { width: 280 }) });
}));
app.post('/api/jobs/:id/pay', auth, mine, wrap((req, res) => {
  const txn = (req.body.txn_id || '').trim();
  if (!/^[A-Za-z0-9]{8,30}$/.test(txn)) throw new Error('Enter the UPI transaction ID (8-30 letters/digits)');
  if (db.prepare('SELECT 1 FROM jobs WHERE txn_id=? AND id<>?').get(txn, req.job.id)) throw new Error('This transaction ID was already used');
  if (req.job.status !== 'pending_payment') throw new Error('Not awaiting payment');
  db.prepare('UPDATE jobs SET txn_id=?,status=? WHERE id=?').run(txn, 'payment_submitted', req.job.id);
  res.json({});
}));
app.post('/api/jobs/:id/cancel', auth, mine, wrap((req, res) => {
  if (!['quoted', 'pending_payment'].includes(req.job.status)) throw new Error('Cannot cancel now');
  setStatus(req.job.id, 'rejected', ",note='Cancelled by user'"); res.json({});
}));

const JOBS = `SELECT j.id,j.user_id,j.printer_id,j.file_name,j.grams,j.minutes,j.exact,j.price,j.user_type,j.status,j.txn_id,j.paid_amount,j.created,j.started,j.finished,j.note,j.source,COALESCE(u.name,'Direct print') user_name,u.email,p.name printer FROM jobs j LEFT JOIN users u ON u.id=j.user_id JOIN printers p ON p.id=j.printer_id`;
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
app.post('/api/admin/jobs/:id/:action', auth, admin, wrap(async (req, res) => {
  const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id); if (!j) throw new Error('Not found');
  const a = req.params.action, now = "datetime('now')";
  if (a === 'approve' && j.status === 'payment_submitted') db.prepare('UPDATE jobs SET status=?,paid_amount=price WHERE id=?').run('queued', j.id);
  else if (a === 'reject' && ['payment_submitted', 'pending_payment', 'queued'].includes(j.status))
    db.prepare('UPDATE jobs SET status=?,note=? WHERE id=?').run('rejected', String(req.body.note || 'Rejected by admin'), j.id);
  else if (a === 'start' && j.status === 'queued') {
    const p = db.prepare('SELECT * FROM printers WHERE id=?').get(j.printer_id);
    if (p.status === 'printing') throw new Error(`${p.name} is busy`);
    await driver.start(p, j);
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
