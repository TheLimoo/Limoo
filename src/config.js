// src/config.js
const path = require('path');

const config = {
  // Data directory (persistent volume)
  dataDir: process.env.DATA_DIR || '/data/limoo',

  // DB path
  get dbPath() {
    return path.join(this.dataDir, 'limoo.db');
  },

  // Xray config path
  get xrayConfigPath() {
    return path.join(this.dataDir, 'config.json');
  },

  // Server port
  port: parseInt(process.env.PORT || '3000', 10),

  // Auth credentials
  username: process.env.LIMOO_USER || 'admin',
  password: process.env.LIMOO_PASS || 'changeme',

  // Domain settings for subscription links
  domain: process.env.LIMOO_DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost',
  tcpDomain: process.env.LIMOO_TCP_DOMAIN || 'localhost',
  tcpPort: parseInt(process.env.LIMOO_TCP_PORT || '443', 10),

  // Xray internal ports
  xrayStatsPort: 10085,
  xrayWsPort: 10080,
  xrayRealityPort: 8443,

  // Xray process management
  xrayMaxRetries: 5,
  xrayRetryWindowMs: 60000,

  // Cookie settings
  cookieName: 'limoo_session',
  cookieMaxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days

  // Ensure data directory exists
  ensureDataDir() {
    const fs = require('fs');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }
};

module.exports = config;
