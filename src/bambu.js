// Read-only live status from Bambu printers over LAN MQTT (port 8883, user "bblp", password = access code).
const mqtt = require('mqtt');
const { db } = require('./db');

const clients = new Map();   // printer id -> mqtt client
const live = new Map();      // printer id -> latest info

const stateOf = g => ({ RUNNING: 'printing', PREPARE: 'printing', PAUSE: 'paused' }[g] || 'idle');

function apply(id, d) {
  const cur = { ...(live.get(id) || {}), ...d, updated: Date.now() };
  live.set(id, cur);
  const status = stateOf(cur.gcode_state);
  db.prepare('UPDATE printers SET status=? WHERE id=?').run(status, id);
  // finish the app's job automatically when the printer reports the end of the print
  const job = db.prepare("SELECT id FROM jobs WHERE printer_id=? AND status='printing'").get(id);
  if (job && (cur.gcode_state === 'FINISH' || cur.gcode_state === 'FAILED'))
    db.prepare("UPDATE jobs SET status=?,finished=datetime('now') WHERE id=?").run(cur.gcode_state === 'FINISH' ? 'done' : 'failed', job.id);
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
    nozzle: l.nozzle_temper ?? null, bed: l.bed_temper ?? null, file: l.subtask_name || l.gcode_file || null, layer: l.layer_num ?? null, total_layers: l.total_layer_num ?? null };
};
const start = () => db.prepare('SELECT * FROM printers').all().forEach(connect);
module.exports = { connect, disconnect, info, start };
