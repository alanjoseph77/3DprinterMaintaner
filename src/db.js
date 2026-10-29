const Database = require('better-sqlite3');
const fs = require('node:fs');
fs.mkdirSync('data', { recursive: true });
const db = new Database(process.env.DB_PATH || 'data/app.db');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, pass TEXT,
  type TEXT DEFAULT 'individual',      -- 'csd' | 'individual'
  is_admin INTEGER DEFAULT 0, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER);
CREATE TABLE IF NOT EXISTS printers(
  id INTEGER PRIMARY KEY, name TEXT UNIQUE, ip TEXT, serial TEXT, access_code TEXT,
  status TEXT DEFAULT 'idle');
CREATE TABLE IF NOT EXISTS jobs(
  id INTEGER PRIMARY KEY, user_id INTEGER, printer_id INTEGER, file_name TEXT, file_path TEXT,
  grams REAL, minutes REAL, exact INTEGER, price REAL, user_type TEXT,
  status TEXT,  -- pending_payment | payment_submitted | queued | printing | done | failed | rejected
  txn_id TEXT, paid_amount REAL, created TEXT DEFAULT CURRENT_TIMESTAMP,
  started TEXT, finished TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
`);

const defaults = { rate_per_gram: '5', rate_per_hour: '10', min_price: '10', upi_id: 'yourname@upi', payee: 'Print Lab', csd_gram_limit: '0' };
for (const [k, v] of Object.entries(defaults))
  db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k, v);
for (const n of ['P1S', 'P2S'])
  db.prepare('INSERT OR IGNORE INTO printers(name) VALUES(?)').run(n);

const settings = () => Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]));
module.exports = { db, settings };
