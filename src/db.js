// src/db.js
const Database = require('better-sqlite3');
const config = require('./config');
const crypto = require('crypto');

config.ensureDataDir();
const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS inbounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT NOT NULL UNIQUE,
    protocol TEXT NOT NULL CHECK(protocol IN ('vless','trojan')),
    enabled INTEGER DEFAULT 1,
    remark TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inbound_id INTEGER NOT NULL,
    uuid TEXT,
    password TEXT,
    email TEXT DEFAULT '',
    limit_bytes INTEGER DEFAULT 0,
    expiry_date TEXT,
    enabled INTEGER DEFAULT 1,
    sub_token TEXT UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (inbound_id) REFERENCES inbounds(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS traffic (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL UNIQUE,
    up INTEGER DEFAULT 0,
    down INTEGER DEFAULT 0,
    last_check INTEGER DEFAULT 0,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ─── Migration ────────────────────────────────────────
function migrateDb() {
  const cols = db.prepare("PRAGMA table_info(inbounds)").all().map(c => c.name);

  // If old schema with network_type exists, migrate to clean WS-only schema
  if (cols.includes('network_type')) {
    console.log('[db] Migrating from old schema (removing Reality columns)...');

    // Preserve existing client data
    const oldClients = db.prepare(`
      SELECT c.*, i.protocol, i.tag as old_tag, i.remark
      FROM clients c JOIN inbounds i ON c.inbound_id = i.id
    `).all();

    // Drop and recreate inbounds
    db.exec('DROP TABLE IF EXISTS inbounds');
    db.exec(`
      CREATE TABLE inbounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag TEXT NOT NULL UNIQUE,
        protocol TEXT NOT NULL CHECK(protocol IN ('vless','trojan')),
        enabled INTEGER DEFAULT 1,
        remark TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Re-create old inbounds from old data (WS only)
    const seenTags = new Set();
    for (const c of oldClients) {
      if (!seenTags.has(c.old_tag)) {
        seenTags.add(c.old_tag);
        db.prepare('INSERT OR IGNORE INTO inbounds (tag, protocol, remark) VALUES (?, ?, ?)').run(
          c.old_tag, c.protocol, c.remark || ''
        );
      }
    }

    console.log('[db] Migration complete');
  }

  // Ensure sub_token exists on clients
  const clientCols = db.prepare("PRAGMA table_info(clients)").all().map(c => c.name);
  if (!clientCols.includes('sub_token')) {
    db.exec("ALTER TABLE clients ADD COLUMN sub_token TEXT");
    const existing = db.prepare("SELECT id FROM clients WHERE sub_token IS NULL").all();
    const update = db.prepare("UPDATE clients SET sub_token = ? WHERE id = ?");
    for (const c of existing) {
      update.run(crypto.randomBytes(16).toString('hex'), c.id);
    }
  }
}

migrateDb();

// ─── Helpers ──────────────────────────────────────────
function randomHex(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function generateUUID() {
  return crypto.randomUUID();
}

function generateSubToken() {
  return crypto.randomBytes(16).toString('hex');
}

// ─── Default Settings ─────────────────────────────────
function initDefaultSettings() {
  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');

  if (!getSetting.get('ws_path')) {
    setSetting.run('ws_path', randomHex(16));
  }
  if (!getSetting.get('panel_domain')) {
    setSetting.run('panel_domain', '');
  }
}

initDefaultSettings();

// ─── Prepared Statements ──────────────────────────────
const stmts = {
  // Settings
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
  getAllSettings: db.prepare('SELECT key, value FROM settings'),

  // Inbounds
  getAllInbounds: db.prepare('SELECT * FROM inbounds ORDER BY created_at DESC'),
  getInboundById: db.prepare('SELECT * FROM inbounds WHERE id = ?'),
  createInbound: db.prepare(
    'INSERT INTO inbounds (tag, protocol, remark) VALUES (?, ?, ?)'
  ),
  updateInbound: db.prepare(
    'UPDATE inbounds SET remark = ?, enabled = ? WHERE id = ?'
  ),
  deleteInbound: db.prepare('DELETE FROM inbounds WHERE id = ?'),

  // Clients
  getClientsByInbound: db.prepare(
    'SELECT c.*, t.up, t.down, t.last_check FROM clients c LEFT JOIN traffic t ON c.id = t.client_id WHERE c.inbound_id = ? ORDER BY c.created_at DESC'
  ),
  getClientById: db.prepare(
    'SELECT c.*, t.up, t.down, t.last_check, i.tag as inbound_tag, i.protocol, i.remark as inbound_remark FROM clients c LEFT JOIN traffic t ON c.id = t.client_id JOIN inbounds i ON c.inbound_id = i.id WHERE c.id = ?'
  ),
  getClientByToken: db.prepare(
    'SELECT c.*, t.up, t.down, i.tag as inbound_tag, i.protocol, i.remark as inbound_remark FROM clients c LEFT JOIN traffic t ON c.id = t.client_id JOIN inbounds i ON c.inbound_id = i.id WHERE c.sub_token = ?'
  ),
  createClient: db.prepare(
    'INSERT INTO clients (inbound_id, uuid, password, email, limit_bytes, expiry_date, enabled, sub_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  updateClient: db.prepare(
    'UPDATE clients SET email = ?, limit_bytes = ?, expiry_date = ?, enabled = ? WHERE id = ?'
  ),
  deleteClient: db.prepare('DELETE FROM clients WHERE id = ?'),

  // Traffic
  upsertTraffic: db.prepare(
    'INSERT OR REPLACE INTO traffic (client_id, up, down, last_check) VALUES (?, ?, ?, ?)'
  ),
  resetTraffic: db.prepare('UPDATE traffic SET up = 0, down = 0, last_check = 0'),
  getAllTraffic: db.prepare(
    'SELECT c.id as client_id, c.email, c.uuid, c.password, t.up, t.down FROM clients c LEFT JOIN traffic t ON c.id = t.client_id'
  ),

  // Dashboard stats
  countInbounds: db.prepare('SELECT COUNT(*) as count FROM inbounds'),
  countEnabledInbounds: db.prepare('SELECT COUNT(*) as count FROM inbounds WHERE enabled = 1'),
  countClients: db.prepare('SELECT COUNT(*) as count FROM clients'),
  totalTraffic: db.prepare('SELECT COALESCE(SUM(up), 0) as total_up, COALESCE(SUM(down), 0) as total_down FROM traffic'),

  // All clients (global list)
  getAllClients: db.prepare(
    'SELECT c.*, t.up, t.down, t.last_check, i.tag as inbound_tag, i.protocol, i.remark as inbound_remark FROM clients c LEFT JOIN traffic t ON c.id = t.client_id JOIN inbounds i ON c.inbound_id = i.id ORDER BY c.created_at DESC'
  ),
};

module.exports = {
  db,
  stmts,
  generateUUID,
  randomHex,
  generateSubToken
};
