// src/db.js
const Database = require('better-sqlite3');
const config = require('./config');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Initialize database
config.ensureDataDir();
const db = new Database(config.dbPath);

// Enable WAL mode and foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS inbounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT NOT NULL UNIQUE,
    protocol TEXT NOT NULL CHECK(protocol IN ('vless','trojan')),
    network_type TEXT NOT NULL CHECK(network_type IN ('ws','reality')),
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
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (inbound_id) REFERENCES inbounds(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS traffic (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
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

// Helper: generate random hex string
function randomHex(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

// Helper: generate UUID v4
function generateUUID() {
  return crypto.randomUUID();
}

// Helper: generate Xray x25519 key pair
function generateX25519Keys() {
  try {
    const output = execSync('xray x25519', { encoding: 'utf-8', timeout: 10000 });
    const lines = output.trim().split('\n');
    let privateKey = '';
    let publicKey = '';
    for (const line of lines) {
      if (line.startsWith('Private key:')) {
        privateKey = line.split('Private key:')[1].trim();
      } else if (line.startsWith('Public key:')) {
        publicKey = line.split('Public key:')[1].trim();
      }
    }
    return { privateKey, publicKey };
  } catch (err) {
    console.error('Failed to generate x25519 keys:', err.message);
    // Fallback: generate random keys (won't work for xray but won't crash)
    return {
      privateKey: randomHex(44),
      publicKey: randomHex(44)
    };
  }
}

// Initialize default settings if not present
function initDefaultSettings() {
  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');

  if (!getSetting.get('ws_path')) {
    setSetting.run('ws_path', randomHex(16));
  }
  if (!getSetting.get('reality_dest')) {
    setSetting.run('reality_dest', 'www.microsoft.com:443');
  }
  if (!getSetting.get('reality_server_name')) {
    setSetting.run('reality_server_name', 'www.microsoft.com');
  }
  if (!getSetting.get('reality_short_id')) {
    setSetting.run('reality_short_id', randomHex(8));
  }
  if (!getSetting.get('reality_private_key') || !getSetting.get('reality_public_key')) {
    const keys = generateX25519Keys();
    setSetting.run('reality_private_key', keys.privateKey);
    setSetting.run('reality_public_key', keys.publicKey);
  }
  if (!getSetting.get('tcp_domain')) {
    setSetting.run('tcp_domain', '');
  }
  if (!getSetting.get('tcp_port')) {
    setSetting.run('tcp_port', '443');
  }
}

// Initialize on load
initDefaultSettings();

// Prepared statements
const stmts = {
  // Settings
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
  getAllSettings: db.prepare('SELECT key, value FROM settings'),

  // Inbounds
  getAllInbounds: db.prepare('SELECT * FROM inbounds ORDER BY created_at DESC'),
  getInboundById: db.prepare('SELECT * FROM inbounds WHERE id = ?'),
  createInbound: db.prepare(
    'INSERT INTO inbounds (tag, protocol, network_type, remark) VALUES (?, ?, ?, ?)'
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
    'SELECT c.*, t.up, t.down, t.last_check, i.tag as inbound_tag, i.protocol, i.network_type, i.remark as inbound_remark FROM clients c LEFT JOIN traffic t ON c.id = t.client_id JOIN inbounds i ON c.inbound_id = i.id WHERE c.id = ?'
  ),
  createClient: db.prepare(
    'INSERT INTO clients (inbound_id, uuid, password, email, limit_bytes, expiry_date, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ),
  updateClient: db.prepare(
    'UPDATE clients SET email = ?, limit_bytes = ?, expiry_date = ?, enabled = ? WHERE id = ?'
  ),
  deleteClient: db.prepare('DELETE FROM clients WHERE id = ?'),

  // Traffic
  getTrafficByClient: db.prepare('SELECT * FROM traffic WHERE client_id = ?'),
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
};

module.exports = {
  db,
  stmts,
  generateUUID,
  randomHex,
  generateX25519Keys,
  initDefaultSettings
};
