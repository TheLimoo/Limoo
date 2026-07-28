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

// ─── Middleware ────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(__dirname + '/public'));

// ─── API Routes ───────────────────────────────────────────
app.use(routes);

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(__dirname + '/public/index.html');
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ─── WebSocket Proxy ──────────────────────────────────────
const wsProxy = httpProxy.createProxyServer({
  target: `http://127.0.0.1:${config.xrayWsPort}`,
  ws: true,
  changeOrigin: true
});

wsProxy.on('error', (err, req, res) => {
  console.error('[ws-proxy] Error:', err.message);
  if (res && res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway');
  }
});

// Handle WebSocket upgrade requests
server.on('upgrade', (req, socket, head) => {
  // Only proxy WebSocket requests that match the WS path
  const wsPath = require('./src/db').stmts.getSetting.get('ws_path')?.value;
  if (wsPath && req.url.startsWith(`/${wsPath}`)) {
    wsProxy.ws(req, socket, head, { target: `http://127.0.0.1:${config.xrayWsPort}` });
  } else {
    socket.destroy();
  }
});

// Handle HTTP requests for the WS path (xray WS also handles HTTP upgrades)
app.use((req, res, next) => {
  const wsPath = require('./src/db').stmts.getSetting.get('ws_path')?.value;
  if (wsPath && req.url.startsWith(`/${wsPath}`)) {
    wsProxy.web(req, res);
  } else {
    next();
  }
});

// ─── Start Server ─────────────────────────────────────────
const PORT = config.port;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[limoo] Server running on port ${PORT}`);
  console.log(`[limoo] Panel: http://0.0.0.0:${PORT}`);

  // Start xray-core
  try {
    startXray();
    console.log('[limoo] Xray-core started');
  } catch (err) {
    console.error('[limoo] Failed to start xray:', err.message);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[limoo] Shutting down...');
  const { stopXray } = require('./src/xray-manager');
  stopXray();
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[limoo] Interrupted, shutting down...');
  const { stopXray } = require('./src/xray-manager');
  stopXray();
  server.close(() => {
    process.exit(0);
  });
});

module.exports = { app, server };
