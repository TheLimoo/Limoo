// src/xray-manager.js
const { spawn } = require('child_process');
const fs = require('fs');
const config = require('./config');
const { stmts } = require('./db');

let xrayProcess = null;
let xrayStartTime = null;
let retryCount = 0;
let retryTimer = null;
let isRestarting = false;

// Build xray config from database — WS only, single inbound
function buildXrayConfig() {
  const wsPath = stmts.getSetting.get('ws_path')?.value || '0000000000000000';
  const now = new Date().toISOString();

  const inbounds = stmts.getAllInbounds.all();
  const enabledInbounds = inbounds.filter(i => i.enabled === 1);

  const xrayInbounds = [];

  // API inbound for stats
  xrayInbounds.push({
    tag: 'api',
    listen: '127.0.0.1',
    port: config.xrayStatsPort,
    protocol: 'dokodemo-door',
    settings: { address: '127.0.0.1' }
  });

  // Merge ALL enabled WS inbounds into a single xray inbound
  const wsClients = [];
  let wsProtocol = 'vless'; // default

  for (const inbound of enabledInbounds) {
    wsProtocol = inbound.protocol;
    const clients = stmts.getClientsByInbound.all(inbound.id);

    for (const client of clients) {
      if (client.enabled !== 1) continue;
      if (client.expiry_date && new Date(client.expiry_date) < new Date(now)) continue;
      if (client.limit_bytes > 0 && client.limit_bytes < (client.up || 0) + (client.down || 0)) continue;

      const clientObj = { email: client.email || `user-${client.id}` };
      if (inbound.protocol === 'vless') {
        clientObj.id = client.uuid;
      } else {
        clientObj.password = client.password;
      }
      wsClients.push(clientObj);
    }
  }

  if (wsClients.length > 0) {
    xrayInbounds.push({
      tag: 'ws-inbound',
      listen: '127.0.0.1',
      port: config.xrayWsPort,
      protocol: wsProtocol,
      settings: {
        clients: wsClients,
        decryption: 'none'
      },
      streamSettings: {
        network: 'ws',
        wsSettings: { path: `/${wsPath}` }
      },
      sniffing: {
        enabled: true,
        destOverride: ['http', 'tls']
      }
    });
  }

  return {
    log: { loglevel: 'none', access: '/dev/null', error: '/dev/null' },
    stats: {},
    api: { tag: 'api', services: ['StatsService'] },
    policy: {
      levels: { '0': { statsUserUplink: true, statsUserDownlink: true } },
      system: { statsInboundUplink: true, statsInboundDownlink: true }
    },
    inbounds: xrayInbounds,
    outbounds: [
      { protocol: 'freedom', tag: 'direct' },
      { protocol: 'blackhole', tag: 'blocked' }
    ],
    routing: {
      domainStrategy: 'AsIs',
      rules: []
    }
  };
}

function writeConfig() {
  const configData = buildXrayConfig();
  fs.writeFileSync(config.xrayConfigPath, JSON.stringify(configData, null, 2), 'utf-8');
  return configData;
}

function startXray() {
  if (xrayProcess) {
    console.log('[xray] Already running, stopping first...');
    stopXray();
  }

  try {
    writeConfig();
  } catch (err) {
    console.error('[xray] Failed to write config:', err.message);
    return;
  }

  console.log('[xray] Starting xray-core...');
  xrayProcess = spawn('xray', ['run', '-c', config.xrayConfigPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env }
  });

  xrayStartTime = Date.now();

  xrayProcess.stdout.on('data', () => {});
  xrayProcess.stderr.on('data', () => {});

  xrayProcess.on('error', (err) => {
    console.error('[xray] Process error:', err.message);
    handleCrash();
  });

  xrayProcess.on('exit', (code, signal) => {
    console.log(`[xray] Exited code=${code} signal=${signal}`);
    xrayProcess = null;
    if (!isRestarting) handleCrash();
  });

  console.log('[xray] Started');
}

function handleCrash() {
  const now = Date.now();
  if (xrayStartTime && (now - xrayStartTime) > config.xrayRetryWindowMs) {
    retryCount = 0;
  }

  retryCount++;
  if (retryCount > config.xrayMaxRetries) {
    console.error(`[xray] Max retries (${config.xrayMaxRetries}) exceeded`);
    return;
  }

  console.log(`[xray] Retrying in 2s (${retryCount}/${config.xrayMaxRetries})`);
  retryTimer = setTimeout(() => startXray(), 2000);
}

function stopXray() {
  isRestarting = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (xrayProcess) {
    try { xrayProcess.kill('SIGTERM'); } catch (e) {}
    xrayProcess = null;
  }
  xrayStartTime = null;
  isRestarting = false;
}

function reloadXray() {
  console.log('[xray] Reloading config...');
  isRestarting = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  isRestarting = false;
  startXray();
}

function getStatus() {
  const running = xrayProcess !== null && !xrayProcess.killed;
  return {
    running,
    uptime: running && xrayStartTime ? Math.floor((Date.now() - xrayStartTime) / 1000) : 0,
    pid: xrayProcess ? xrayProcess.pid : null,
    retries: retryCount
  };
}

module.exports = { buildXrayConfig, writeConfig, startXray, stopXray, reloadXray, getStatus };
