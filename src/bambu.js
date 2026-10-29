// Read-only live status from Bambu printers over LAN MQTT (port 8883, user "bblp", password = access code).
const mqtt = require('mqtt');
const { db } = require('./db');
const fs = require('node:fs');
const { Writable } = require('node:stream');
const ftp = require('basic-ftp');
const { from3mf } = require('./slice');

const clients = new Map();   // printer id -> mqtt client
const live = new Map();      // printer id -> latest info

const stateOf = g => ({ RUNNING: 'printing', PREPARE: 'printing', PAUSE: 'paused' }[g] || 'idle');

function apply(id, d) {
  const cur = { ...(live.get(id) || {}), ...d, updated: Date.now() };
  live.set(id, cur);
  const status = stateOf(cur.gcode_state);
  db.prepare('UPDATE printers SET status=? WHERE id=?').run(status, id);
  trackJobs(id, cur);
}

// Log every print the printer really runs: link it to the app job if one is "printing", otherwise record it as a direct print.
const track = new Map();   // printer id -> { jobId }
function trackJobs(id, cur) {
  const running = ['RUNNING', 'PREPARE', 'PAUSE'].includes(cur.gcode_state);
  const t = track.get(id);
  if (running && !t) {
    const name = cur.subtask_name || cur.gcode_file || 'Unknown print';
    let job = db.prepare("SELECT * FROM jobs WHERE printer_id=? AND status='printing' ORDER BY id DESC").get(id);
    if (!job) {
      const r = db.prepare("INSERT INTO jobs(user_id,printer_id,file_name,grams,minutes,exact,price,user_type,status,source,started) VALUES(NULL,?,?,0,0,0,0,'direct','printing','printer',datetime('now'))").run(id, name);
      job = { id: Number(r.lastInsertRowid) };
    } else if (!job.started) db.prepare("UPDATE jobs SET started=datetime('now') WHERE id=?").run(job.id);
    track.set(id, { jobId: job.id });
    if (!fs.existsSync(`uploads/thumb_${job.id}.png`)) fetchThumb(id, job.id, name);
  } else if (!running && t) {
    track.delete(id);
    const end = cur.gcode_state === 'FINISH' ? 'done' : 'failed';
    db.prepare("UPDATE jobs SET status=?,finished=datetime('now'),note=COALESCE(note,?) WHERE id=? AND status='printing'")
      .run(end, cur.gcode_state === 'FINISH' || cur.gcode_state === 'FAILED' ? null : 'Stopped before finishing', t.jobId);
  }
}

// Best effort: the printer keeps the sent .3mf in its file store; grab it over FTPS to read the preview picture and filament use.
async function fetchThumb(id, jobId, name) {
  const p = db.prepare('SELECT * FROM printers WHERE id=?').get(id);
  if (!p?.ip || !p.access_code) return;
  const c = new ftp.Client(15000);
  try {
    await c.access({ host: p.ip, port: 990, user: 'bblp', password: p.access_code, secure: 'implicit', secureOptions: { rejectUnauthorized: false } });
    const base = String(name).replace(/\.gcode\.3mf$|\.3mf$|\.gcode$/i, '').toLowerCase();
    let hit = null;
    for (const dir of ['/', '/cache', '/model']) {
      let list = []; try { list = await c.list(dir); } catch { continue; }
      hit = list.find(f => f.isFile && /\.3mf$/i.test(f.name) && f.name.toLowerCase().includes(base));
      if (hit) { hit.dir = dir; break; }
    }
    if (!hit) throw new Error('model file not found on printer');
    const chunks = [];
    await c.downloadTo(new Writable({ write(ch, _e, cb) { chunks.push(ch); cb(); } }), `${hit.dir === '/' ? '' : hit.dir}/${hit.name}`);
    const info = from3mf(Buffer.concat(chunks));
    if (info.thumb) fs.writeFileSync(`uploads/thumb_${jobId}.png`, info.thumb);
    db.prepare("UPDATE jobs SET grams=?,minutes=?,exact=1 WHERE id=? AND source='printer'").run(info.grams, info.minutes, jobId);
    live.set(id, { ...live.get(id), thumb_error: null });
  } catch (e) {
    live.set(id, { ...live.get(id), thumb_error: e.message });
  } finally { c.close(); }
}

function connect(p) {
  disconnect(p.id);
  if (!p.ip || !p.serial || !p.access_code) return;
  const c = mqtt.connect(`mqtts://${p.ip}:8883`, {
    username: 'bblp', password: p.access_code, rejectUnauthorized: false, // printer uses a self-signed cert
    clientId: 'printlab_' + Math.random().toString(16).slice(2, 8), reconnectPeriod: 5000, connectTimeout: 8000,
  });
  clients.set(p.id, c);
  const topic = `device/${p.serial}/report`;
  c.on('connect', () => {
    live.set(p.id, { ...(live.get(p.id) || {}), online: true, error: null });
    c.subscribe(topic);
    c.publish(`device/${p.serial}/request`, JSON.stringify({ pushing: { sequence_id: '1', command: 'pushall' } }));
  });
  c.on('message', (_t, buf) => { try { const m = JSON.parse(buf).print; if (m) apply(p.id, { online: true, ...m }); } catch {} });
  c.on('error', e => live.set(p.id, { ...(live.get(p.id) || {}), online: false, error: e.message }));
  c.on('close', () => { const l = live.get(p.id); if (l) l.online = false; });
  // re-poll full status every minute (printers only send changes)
  c.pollTimer = setInterval(() => c.connected && c.publish(`device/${p.serial}/request`, JSON.stringify({ pushing: { sequence_id: '2', command: 'pushall' } })), 60000);
}
function disconnect(id) { const c = clients.get(id); if (c) { clearInterval(c.pollTimer); c.end(true); clients.delete(id); } live.delete(id); }

const info = id => {
  const l = live.get(id); if (!l) return null;
  return { online: !!l.online, error: l.error || null, state: l.gcode_state || null, percent: l.mc_percent ?? null, remaining_min: l.mc_remaining_time ?? null,
    nozzle: l.nozzle_temper ?? null, bed: l.bed_temper ?? null, file: l.subtask_name || l.gcode_file || null, layer: l.layer_num ?? null, total_layers: l.total_layer_num ?? null,
    chamber: l.chamber_temper ?? null, speed: l.spd_lvl ?? null, speed_pct: l.spd_mag ?? null, wifi: l.wifi_signal ?? null, errors: Array.isArray(l.hms) ? l.hms.length : 0,
    gcode_file: l.gcode_file || null, updated: l.updated || null };
};
const raw = id => live.get(id) || null;
const start = () => db.prepare('SELECT * FROM printers').all().forEach(connect);
module.exports = { connect, disconnect, info, raw, start, _apply: apply };
