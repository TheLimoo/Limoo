// src/config.js
const path = require('path');

const config = {
  dataDir: process.env.DATA_DIR || '/data/limoo',

  get dbPath() {
    return path.join(this.dataDir, 'limoo.db');
  },

  get xrayConfigPath() {
    return path.join(this.dataDir, 'config.json');
  },

  port: parseInt(process.env.PORT || '2053', 10),
  password: process.env.LIMOO_PASS || 'Mohammad@23',

  xrayStatsPort: 10085,
  xrayWsPort: 10080,

  xrayMaxRetries: 5,
  xrayRetryWindowMs: 60000,

  cookieName: 'limoo_session',
  cookieMaxAgeMs: 7 * 24 * 60 * 60 * 1000,

  ensureDataDir() {
    const fs = require('fs');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }
};

module.exports = config;
