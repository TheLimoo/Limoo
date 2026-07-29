// server.js
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const httpProxy = require('http-proxy');
const config = require('./src/config');
const { startXray } = require('./src/xray-manager');
const routes = require('./src/routes');

const app = express();
const server = http.createServer(app);

// ─── Middleware ────────────────────────────────────────
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(__dirname + '/public'));

// ─── WebSocket Proxy ──────────────────────────────────
const wsProxy = httpProxy.createProxyServer({
  target: `http://127.0.0.1:${config.xrayWsPort}`,
  ws: true,
  changeOrigin: true
});

wsProxy.on('error', (err) => {
  console.error('[ws-proxy] Error:', err.message);
});

// Handle WebSocket upgrade (before Express routes)
server.on('upgrade', (req, socket, head) => {
  const { stmts } = require('./src/db');
  const wsPath = stmts.getSetting.get('ws_path')?.value;
  if (wsPath && req.url.startsWith(`/${wsPath}`)) {
    wsProxy.ws(req, socket, head, { target: `http://127.0.0.1:${config.xrayWsPort}` });
  } else {
    socket.destroy();
  }
});

// ─── API Routes ───────────────────────────────────────
app.use(routes);

// ─── WS path HTTP proxy (before SPA fallback) ────────
app.use((req, res, next) => {
  const { stmts } = require('./src/db');
  const wsPath = stmts.getSetting.get('ws_path')?.value;
  if (wsPath && req.url.startsWith(`/${wsPath}`)) {
    wsProxy.web(req, res);
  } else {
    next();
  }
});

// ─── SPA fallback ─────────────────────────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(__dirname + '/public/index.html');
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ─── Traffic stats polling ─────────────────────────────
let trafficPollTimer = null;
let lastTrafficPoll = 0;

function startTrafficPolling() {
  if (trafficPollTimer) return;
  console.log('[traffic] Starting periodic polling (every 10s)');
  // Initial poll
  updateTrafficStats();
  // Poll every 10 seconds
  trafficPollTimer = setInterval(() => {
    updateTrafficStats();
  }, 10000);
}

function stopTrafficPolling() {
  if (trafficPollTimer) {
    clearInterval(trafficPollTimer);
    trafficPollTimer = null;
    console.log('[traffic] Stopped polling');
  }
}

// ─── Start Server ─────────────────────────────────────
const PORT = config.port;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[limoo] Server running on port ${PORT}`);
  try {
    startXray();
    startTrafficPolling();
    console.log('[limoo] Xray-core started');
  } catch (err) {
    console.error('[limoo] Failed to start xray:', err.message);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[limoo] Shutting down...');
  stopTrafficPolling();
  const { stopXray } = require('./src/xray-manager');
  stopXray();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[limoo] Interrupted, shutting down...');
  stopTrafficPolling();
  const { stopXray } = require('./src/xray-manager');
  stopXray();
  server.close(() => process.exit(0));
});

module.exports = { app, server };
