// src/xray-manager.js
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const config = require('./config');
const { db, stmts } = require('./db');

let xrayProcess = null;
let xrayStartTime = null;
let retryCount = 0;
let retryTimer = null;
let isRestarting = false;

// Build xray config from database state
function buildXrayConfig() {
  const wsPath = stmts.getSetting.get('ws_path')?.value || '0000000000000000';
  const realityDest = stmts.getSetting.get('reality_dest')?.value || 'www.microsoft.com:443';
  const realityServerName = stmts.getSetting.get('reality_server_name')?.value || 'www.microsoft.com';
  const realityPrivateKey = stmts.getSetting.get('reality_private_key')?.value || '';
  const realityPublicKey = stmts.getSetting.get('reality_public_key')?.value || '';
  const realityShortId = stmts.getSetting.get('reality_short_id')?.value || '00000000';

  const now = new Date().toISOString();

  const inbounds = stmts.getAllInbounds.all();
  const xrayInbounds = [];

  // API inbound
  xrayInbounds.push({
    tag: 'api',
    listen: '127.0.0.1',
    port: config.xrayStatsPort,
    protocol: 'dokodemo-door',
    settings: { address: '127.0.0.1' }
  });

  // Group inbounds by network type
  const wsInbounds = inbounds.filter(i => i.network_type === 'ws' && i.enabled === 1);
  const realityInbounds = inbounds.filter(i => i.network_type === 'reality' && i.enabled === 1);

  // Build WS inbound
  if (wsInbounds.length > 0) {
    const wsClients = [];
    for (const inbound of wsInbounds) {
      const clients = stmts.getClientsByInbound.all(inbound.id);
      for (const client of clients) {
        // Skip disabled clients
        if (client.enabled !== 1) continue;
        // Skip expired clients
        if (client.expiry_date && new Date(client.expiry_date) < new Date(now)) continue;
        // Skip clients over data limit
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
        protocol: wsInbounds[0].protocol,
        settings: {
          clients: wsClients,
          decryption: 'none'
        },
        streamSettings: {
          network: 'ws',
          wsSettings: { path: `/${wsPath}` }
        },
        sniffing: { enabled: true, destOverride: ['http', 'tls'] }
      });
    }
  }

  // Build Reality inbound
  if (realityInbounds.length > 0) {
    const realityClients = [];
    for (const inbound of realityInbounds) {
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
        realityClients.push(clientObj);
      }
    }

    if (realityClients.length > 0) {
      xrayInbounds.push({
        tag: 'reality-inbound',
        listen: '127.0.0.1',
        port: config.xrayRealityPort,
        protocol: realityInbounds[0].protocol,
        settings: {
          clients: realityClients,
          decryption: 'none'
        },
        streamSettings: {
          network: 'xhttp',
          security: 'reality',
          realitySettings: {
            show: false,
            dest: realityDest,
            xver: 0,
            serverNames: [realityServerName],
            privateKey: realityPrivateKey,
            shortIds: [realityShortId],
            publicKey: realityPublicKey,
            id: realityShortId
          },
          xhttpSettings: {
            mode: 'packet-up',
            path: '/'
          }
        },
        sniffing: { enabled: true, destOverride: ['http', 'tls'] }
      });
    }
  }

  const xrayConfig = {
    log: {
      loglevel: 'warning',
      access: '/dev/null',
      error: '/dev/null'
    },
    stats: {},
    api: {
      tag: 'api',
      services: ['StatsService']
    },
    policy: {
      levels: {
        '0': {
          statsUserUplink: true,
          statsUserDownlink: true
        }
      },
      system: {
        statsInboundUplink: true,
        statsInboundDownlink: true
      }
    },
    inbounds: xrayInbounds,
    outbounds: [
      { protocol: 'freedom', tag: 'direct' },
      { protocol: 'blackhole', tag: 'blocked' }
    ],
    routing: {
      domainStrategy: 'AsIs',
      rules: [
        { type: 'field', inboundTag: ['api'], outboundTag: 'api' }
      ]
    }
  };

  return xrayConfig;
}

// Write config to file
function writeConfig() {
  const configData = buildXrayConfig();
  fs.writeFileSync(config.xrayConfigPath, JSON.stringify(configData, null, 2), 'utf-8');
  console.log('[xray] Config written to', config.xrayConfigPath);
  return configData;
}

// Start xray process
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

  xrayProcess.stdout.on('data', (data) => {
    console.log('[xray stdout]', data.toString().trim());
  });

  xrayProcess.stderr.on('data', (data) => {
    console.error('[xray stderr]', data.toString().trim());
  });

  xrayProcess.on('error', (err) => {
    console.error('[xray] Process error:', err.message);
    handleCrash();
  });

  xrayProcess.on('exit', (code, signal) => {
    console.log(`[xray] Process exited with code ${code}, signal ${signal}`);
    xrayProcess = null;
    if (!isRestarting) {
      handleCrash();
    }
  });

  console.log('[xray] Started successfully');
}

// Handle crash with retry logic
function handleCrash() {
  const now = Date.now();
  if (xrayStartTime && (now - xrayStartTime) > config.xrayRetryWindowMs) {
    retryCount = 0;
  }

  retryCount++;
  if (retryCount > config.xrayMaxRetries) {
    console.error(`[xray] Max retries (${config.xrayMaxRetries}) exceeded. Stopping restart attempts.`);
    return;
  }

  console.log(`[xray] Retrying in 2s... (attempt ${retryCount}/${config.xrayMaxRetries})`);
  retryTimer = setTimeout(() => {
    startXray();
  }, 2000);
}

// Stop xray process
function stopXray() {
  isRestarting = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (xrayProcess) {
    try {
      xrayProcess.kill('SIGTERM');
    } catch (err) {
      // Process might already be dead
    }
    xrayProcess = null;
  }
  xrayStartTime = null;
  isRestarting = false;
}

// Reload xray config (restart with new config)
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

// Get xray status
function getStatus() {
  const running = xrayProcess !== null && !xrayProcess.killed;
  return {
    running,
    uptime: running && xrayStartTime ? Math.floor((Date.now() - xrayStartTime) / 1000) : 0,
    pid: xrayProcess ? xrayProcess.pid : null,
    retries: retryCount
  };
}

module.exports = {
  buildXrayConfig,
  writeConfig,
  startXray,
  stopXray,
  reloadXray,
  getStatus
};
