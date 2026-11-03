// Printer driver: slice the part (Bambu Studio CLI), upload the .gcode.3mf over FTPS, start it over MQTT.
// A sliced .3mf upload is sent as-is; an .stl is sliced here with the job's material, layer, infill, supports and copies.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { unzipSync } = require('fflate');
const { db, settings } = require('./db');
const { from3mf } = require('./slice');
const bambu = require('./bambu');

const DEFAULT_SLICER = 'C:\\Program Files\\Bambu Studio\\bambu-studio.exe';
const slicerPath = () => {   // a folder is accepted too: the exe inside it is used
  const p = (settings().slicer_path?.trim() || process.env.SLICER_PATH || DEFAULT_SLICER).replace(/^"|"$/g, '');
  return /\.exe$/i.test(p) ? p : path.join(p, 'bambu-studio.exe');
};
const hasGcode = buf => { try { return Object.keys(unzipSync(new Uint8Array(buf), { filter: f => /^Metadata\/plate_\d+\.gcode$/.test(f.name) })).length > 0; } catch { return false; } };

// ---- Bambu system profiles (resources/profiles/BBL), with "inherits" resolved so the CLI gets complete settings ----
let index = null, indexDir = null;   // name -> { sub, json }
function profiles() {
  const dir = path.join(path.dirname(slicerPath()), 'resources', 'profiles', 'BBL');
  if (index && indexDir === dir) return index;
  if (!fs.existsSync(dir)) throw new Error(`Bambu Studio profiles not found at ${dir}. Install Bambu Studio or set the slicer path under Admin > Settings.`);
  index = new Map(); indexDir = dir;
  for (const sub of ['machine', 'process', 'filament']) {
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.json')) try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j.name) index.set(j.name, { sub, json: j }); } catch {}
    } };
    if (fs.existsSync(path.join(dir, sub))) walk(path.join(dir, sub));
  }
  return index;
}
function resolve(name, depth = 0) {
  const p = profiles().get(name); if (!p) throw new Error(`Slicer profile "${name}" not found`);
  if (!p.json.inherits || depth > 10) return { ...p.json };
  const { inherits, ...own } = p.json;
  return { ...resolve(inherits, depth + 1), ...own };
}
const pick = (sub, ok, score) => [...profiles().values()].filter(p => p.sub === sub && p.json.instantiation === 'true')
  .map(p => resolve(p.json.name)).filter(ok).sort((a, b) => score(a) - score(b))[0]?.name;   // filter on inherited keys too

function profilesFor(printer, job) {
  const mname = pick('machine', j => j.name.includes(` ${printer.name} `) && j.name.includes('0.4 nozzle'), () => 0);
  if (!mname) throw new Error(`No Bambu Studio machine profile for ${printer.name} (0.4 nozzle). Update Bambu Studio.`);
  const fits = j => !j.compatible_printers?.length || j.compatible_printers.includes(mname);
  const pname = pick('process', fits, j => Math.abs(parseFloat(j.layer_height) - job.layer) * 100 + (/Standard/.test(j.name) ? 0 : 1));
  const fname = pick('filament', j => fits(j) && [].concat(j.filament_type || []).includes(job.material),
    j => (/^Bambu/.test(j.name) ? 0 : 2) + (/Basic|^Bambu (PETG|ABS|ASA) @|HF/.test(j.name) ? 0 : 1));
  if (!pname) throw new Error(`No process profile for ${printer.name}`);
  if (!fname) throw new Error(`No ${job.material} filament profile for ${printer.name}`);
  const machine = resolve(mname), proc = resolve(pname), filament = resolve(fname);
  Object.assign(proc, { layer_height: String(job.layer), sparse_infill_density: `${job.infill}%`, enable_support: job.supports ? '1' : '0' });
  return { machine, process: proc, filament };
}

function sliceStl(printer, job, dir) {
  const exe = slicerPath();
  if (!fs.existsSync(exe)) throw new Error(`Slicer not found at ${exe}. Install Bambu Studio on the server PC or set the slicer path under Admin > Settings.`);
  const p = profilesFor(printer, job), w = (n, j) => { const f = path.join(dir, n); fs.writeFileSync(f, JSON.stringify(j)); return f; };
  const stl = path.join(dir, 'part.stl'); fs.copyFileSync(job.file_path, stl);
  const out = path.join(dir, 'out.3mf');
  const args = ['--orient', '1', '--arrange', '1', '--load-settings', `${w('machine.json', p.machine)};${w('process.json', p.process)}`,
    '--load-filaments', w('filament.json', p.filament), '--slice', '0', '--export-3mf', out, ...Array(job.copies || 1).fill(stl)];
  return new Promise((ok, fail) => execFile(exe, args, { cwd: dir, timeout: 10 * 60000, windowsHide: true, maxBuffer: 20e6 }, (err, so, se) => {
    if (fs.existsSync(out) && hasGcode(fs.readFileSync(out))) return ok(out);
    const msg = String(se || so || err?.message || '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
    fail(new Error(`Slicing failed${msg ? ': ' + msg : ''}`));
  }));
}

// AMS slot (unit * 4 + tray) loaded with the job's material, as the printer reports it
function amsTray(printer, job) {
  for (const unit of bambu.raw(printer.id)?.ams?.ams || [])
    for (const t of unit.tray || [])
      if (String(t.tray_type || '').toUpperCase() === job.material) return +unit.id * 4 + +t.id;
  throw new Error(`No ${job.material} loaded in the ${printer.name} AMS. Load it, or set "Feed filament from the AMS" to 0 to use the external spool.`);
}

// The job as a sliced Bambu project in `dir` (the upload itself if it is already sliced); refreshes grams, time and preview.
async function sliced(printer, job, dir) {
  if (!job.file_path || !fs.existsSync(job.file_path)) throw new Error('The uploaded file is missing on the server');
  let file = job.file_path;
  if (/\.3mf$/i.test(job.file_name) && hasGcode(fs.readFileSync(file))) { /* already sliced */ }
  else if (/\.stl$/i.test(job.file_name)) file = await sliceStl(printer, job, dir);
  else throw new Error('This 3MF has no sliced plate. Upload an .stl, or export a sliced plate file from Bambu Studio.');
  const buf = fs.readFileSync(file);
  try {   // exact numbers and preview from the real slice (the price already agreed stays the same)
    const info = from3mf(buf);
    db.prepare('UPDATE jobs SET grams=?,minutes=?,exact=1 WHERE id=?').run(info.grams, info.minutes, job.id);
    if (info.thumb) fs.writeFileSync(`uploads/thumb_${job.id}.png`, info.thumb);
  } catch {}
  return { file, buf };
}
// Print name the printer reports back; bambu.js uses the "PrintLab-<id>" prefix to link the print to its job.
const taskName = job => `PrintLab-${job.id} ${(job.part_name || job.file_name).replace(/\.(stl|3mf)$/i, '')}`.replace(/[\\/:*?"<>|]/g, '').slice(0, 80);
const tmpDir = job => fs.mkdtempSync(path.join(os.tmpdir(), `printlab_${job.id}_`));

// For printing by hand: the file exactly as uploaded, named so the print links back to its job
const upload = job => {
  if (!job.file_path || !fs.existsSync(job.file_path)) throw new Error('The uploaded file is missing on the server');
  return { file: job.file_path, name: taskName(job) + (path.extname(job.file_name) || '.stl').toLowerCase() };
};

module.exports = {
  upload,

  // Open the uploaded file in Bambu Studio on this (server) PC. Copies stay a day in uploads/studio so Studio can still read them.
  openInStudio(job) {
    if (!fs.existsSync(slicerPath())) throw new Error(`Bambu Studio not found at ${slicerPath()}`);
    const keep = path.resolve('uploads', 'studio'), { file, name } = upload(job), out = path.join(keep, name);
    fs.mkdirSync(keep, { recursive: true });
    for (const f of fs.readdirSync(keep)) try { if (Date.now() - fs.statSync(path.join(keep, f)).mtimeMs > 864e5) fs.unlinkSync(path.join(keep, f)); } catch {}
    fs.copyFileSync(file, out);
    require('node:child_process').spawn(slicerPath(), [out], { detached: true, stdio: 'ignore' }).unref();
  },

  async start(printer, job) {
    const live = bambu.info(printer.id);
    if (!live?.online) throw new Error(`${printer.name} is not connected${live?.error ? ` (${live.error})` : ''}. Check its IP, serial and access code under Admin > Printer connections.`);
    if (['RUNNING', 'PREPARE', 'PAUSE'].includes(live.state)) throw new Error(`${printer.name} is already printing`);
    if (!live.sdcard) throw new Error(`${printer.name} has no SD card. LAN printing stores the file on the card first: insert a microSD card, or use "Open in Bambu Studio" and press Print there.`);

    const dir = tmpDir(job);
    try {
      const { file, buf } = await sliced(printer, job, dir);
      const plate = Object.keys(unzipSync(new Uint8Array(buf), { filter: f => /^Metadata\/plate_\d+\.gcode$/.test(f.name) }))[0];
      const name = `printlab_${job.id}.gcode.3mf`;
      await bambu.upload(printer.id, file, name);
      const amsOn = settings().use_ams === '1', tray = amsOn ? amsTray(printer, job) : -1;
      await bambu.command(printer.id, { print: {
        sequence_id: String(Date.now() % 1e6), command: 'project_file', param: plate, file: name,
        url: `file:///sdcard/${name}`,
        md5: crypto.createHash('md5').update(buf).digest('hex'), subtask_name: taskName(job),
        project_id: '0', profile_id: '0', task_id: '0', subtask_id: '0',
        bed_type: 'auto', bed_levelling: true, flow_cali: true, vibration_cali: true, layer_inspect: false, timelapse: false,
        use_ams: amsOn, ams_mapping: amsOn ? [tray] : [],
      } });
      return true;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  },
};
