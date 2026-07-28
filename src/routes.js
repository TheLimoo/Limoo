// src/routes.js
const express = require('express');
const QRCode = require('qrcode');
const config = require('./config');
const { db, stmts, generateUUID, randomHex } = require('./db');
const { createSession, destroySession, requireAuth, verifyPassword } = require('./auth');
const { reloadXray, getStatus } = require('./xray-manager');
const { updateTrafficStats, getTrafficSummary, formatBytes } = require('./xray-stats');

const router = express.Router();

// ─── Auth Routes ──────────────────────────────────────────
router.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }
  if (!verifyPassword(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = createSession();
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    maxAge: config.cookieMaxAgeMs,
    sameSite: 'strict'
  });
  res.json({ success: true });
});

router.post('/api/logout', (req, res) => {
  const token = req.cookies[config.cookieName];
  if (token) destroySession(token);
  res.clearCookie(config.cookieName);
  res.json({ success: true });
});

// ─── Protected Routes ─────────────────────────────────────
router.use('/api', requireAuth);

// ─── Status ───────────────────────────────────────────────
router.get('/api/status', (req, res) => {
  try {
    const status = getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Dashboard ────────────────────────────────────────────
router.get('/api/dashboard', (req, res) => {
  try {
    // Update traffic stats from xray
    updateTrafficStats();

    const inbounds = stmts.getAllInbounds.all();
    const traffic = getTrafficSummary();
    const totalClients = stmts.countClients.get();
    const enabledInbounds = stmts.countEnabledInbounds.get();

    res.json({
      stats: {
        totalUp: traffic.totalUp,
        totalUpFormatted: formatBytes(traffic.totalUp),
        totalDown: traffic.totalDown,
        totalDownFormatted: formatBytes(traffic.totalDown),
        totalTraffic: traffic.totalTraffic,
        totalTrafficFormatted: formatBytes(traffic.totalTraffic),
        totalInbounds: inbounds.length,
        enabledInbounds: enabledInbounds.count,
        totalClients: totalClients.count
      },
      inbounds: inbounds.map(i => ({
        ...i,
        client_count: db.prepare(
          'SELECT COUNT(*) as count FROM clients WHERE inbound_id = ?'
        ).get(i.id).count
      })),
      clients: traffic.clients
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Inbounds ─────────────────────────────────────────────
router.get('/api/inbounds', (req, res) => {
  try {
    const inbounds = stmts.getAllInbounds.all();
    const result = inbounds.map(i => ({
      ...i,
      client_count: db.prepare(
        'SELECT COUNT(*) as count FROM clients WHERE inbound_id = ?'
      ).get(i.id).count
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/inbounds', (req, res) => {
  try {
    const { protocol, network_type, remark } = req.body;
    if (!protocol || !network_type) {
      return res.status(400).json({ error: 'protocol and network_type required' });
    }
    if (!['vless', 'trojan'].includes(protocol)) {
      return res.status(400).json({ error: 'protocol must be vless or trojan' });
    }
    if (!['ws', 'reality'].includes(network_type)) {
      return res.status(400).json({ error: 'network_type must be ws or reality' });
    }

    const tag = `${protocol}-${network_type}-${randomHex(4)}`;
    const result = stmts.createInbound.run(tag, protocol, network_type, remark || '');

    const inbound = stmts.getInboundById.get(result.lastInsertRowid);
    reloadXray();
    res.json(inbound);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/inbounds/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { remark, enabled } = req.body;
    const inbound = stmts.getInboundById.get(id);
    if (!inbound) {
      return res.status(404).json({ error: 'Inbound not found' });
    }

    stmts.updateInbound.run(
      remark !== undefined ? remark : inbound.remark,
      enabled !== undefined ? (enabled ? 1 : 0) : inbound.enabled,
      id
    );

    const updated = stmts.getInboundById.get(id);
    reloadXray();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/inbounds/:id', (req, res) => {
  try {
    const { id } = req.params;
    const inbound = stmts.getInboundById.get(id);
    if (!inbound) {
      return res.status(404).json({ error: 'Inbound not found' });
    }

    stmts.deleteInbound.run(id);
    reloadXray();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Clients ──────────────────────────────────────────────
router.get('/api/inbounds/:id/clients', (req, res) => {
  try {
    const { id } = req.params;
    const inbound = stmts.getInboundById.get(id);
    if (!inbound) {
      return res.status(404).json({ error: 'Inbound not found' });
    }

    const clients = stmts.getClientsByInbound.all(id);
    res.json(clients.map(c => ({
      ...c,
      upFormatted: formatBytes(c.up || 0),
      downFormatted: formatBytes(c.down || 0),
      totalFormatted: formatBytes((c.up || 0) + (c.down || 0)),
      isExpired: c.expiry_date ? new Date(c.expiry_date) < new Date() : false,
      isOverLimit: c.limit_bytes > 0 && c.limit_bytes < (c.up || 0) + (c.down || 0)
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/inbounds/:id/clients', (req, res) => {
  try {
    const { id } = req.params;
    const inbound = stmts.getInboundById.get(id);
    if (!inbound) {
      return res.status(404).json({ error: 'Inbound not found' });
    }

    const { email, limit_bytes, expiry_date, enabled } = req.body;
    const uuid = inbound.protocol === 'vless' ? generateUUID() : null;
    const password = inbound.protocol === 'trojan' ? randomHex(16) : null;

    const result = stmts.createClient.run(
      id,
      uuid,
      password,
      email || '',
      limit_bytes || 0,
      expiry_date || null,
      enabled !== undefined ? (enabled ? 1 : 0) : 1
    );

    // Create traffic entry
    stmts.upsertTraffic.run(result.lastInsertRowid, 0, 0, 0);

    const client = stmts.getClientById.get(result.lastInsertRowid);
    reloadXray();
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/clients/:id', (req, res) => {
  try {
    const { id } = req.params;
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { email, limit_bytes, expiry_date, enabled } = req.body;
    stmts.updateClient.run(
      email !== undefined ? email : client.email,
      limit_bytes !== undefined ? limit_bytes : client.limit_bytes,
      expiry_date !== undefined ? expiry_date : client.expiry_date,
      enabled !== undefined ? (enabled ? 1 : 0) : client.enabled,
      id
    );

    const updated = stmts.getClientById.get(id);
    reloadXray();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/clients/:id', (req, res) => {
  try {
    const { id } = req.params;
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    stmts.deleteClient.run(id);
    reloadXray();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Subscription Links ───────────────────────────────────
router.get('/api/clients/:id/link', (req, res) => {
  try {
    const { id } = req.params;
    const client = stmts.getClientById.get(id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const wsPath = stmts.getSetting.get('ws_path')?.value || '0000000000000000';
    const realityServerName = stmts.getSetting.get('reality_server_name')?.value || 'www.microsoft.com';
    const realityPublicKey = stmts.getSetting.get('reality_public_key')?.value || '';
    const realityShortId = stmts.getSetting.get('reality_short_id')?.value || '00000000';

    const domain = req.headers.host || 'localhost';
    const tcpDomain = stmts.getSetting.get('tcp_domain')?.value || req.headers.host || 'localhost';
    const tcpPort = parseInt(stmts.getSetting.get('tcp_port')?.value || '443', 10);
    const remark = client.inbound_remark || 'limoo';
    const clientEmail = client.email || `user-${client.id}`;

    let link = '';

    if (client.network_type === 'ws') {
      const identifier = client.protocol === 'vless' ? client.uuid : client.password;
      const protocol = client.protocol === 'vless' ? 'vless' : 'trojan';

      const params = new URLSearchParams({
        encryption: 'none',
        security: 'tls',
        type: 'ws',
        path: `/${wsPath}`,
        sni: domain
      });

      link = `${protocol}://${identifier}@${domain}:443?${params.toString()}#${encodeURIComponent(`${remark}-${clientEmail}`)}`;
    } else if (client.network_type === 'reality') {
      const identifier = client.protocol === 'vless' ? client.uuid : client.password;
      const protocol = client.protocol === 'vless' ? 'vless' : 'trojan';

      const params = new URLSearchParams({
        encryption: 'none',
        security: 'reality',
        sni: realityServerName,
        fp: 'chrome',
        pbk: realityPublicKey,
        sid: realityShortId,
        type: 'xhttp',
        path: '/'
      });

      link = `${protocol}://${identifier}@${tcpDomain}:${tcpPort}?${params.toString()}#${encodeURIComponent(`${remark}-${clientEmail}`)}`;
    }

    res.json({ link });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// QR Code endpoint
router.get('/api/clients/:id/qr', async (req, res) => {
  try {
    const { id } = req.params;
    const client = stmts.getClientById.get(id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const wsPath = stmts.getSetting.get('ws_path')?.value || '0000000000000000';
    const realityServerName = stmts.getSetting.get('reality_server_name')?.value || 'www.microsoft.com';
    const realityPublicKey = stmts.getSetting.get('reality_public_key')?.value || '';
    const realityShortId = stmts.getSetting.get('reality_short_id')?.value || '00000000';

    const domain = req.headers.host || 'localhost';
    const tcpDomain = stmts.getSetting.get('tcp_domain')?.value || req.headers.host || 'localhost';
    const tcpPort = parseInt(stmts.getSetting.get('tcp_port')?.value || '443', 10);
    const remark = client.inbound_remark || 'limoo';
    const clientEmail = client.email || `user-${client.id}`;

    let link = '';

    if (client.network_type === 'ws') {
      const identifier = client.protocol === 'vless' ? client.uuid : client.password;
      const protocol = client.protocol === 'vless' ? 'vless' : 'trojan';

      const params = new URLSearchParams({
        encryption: 'none',
        security: 'tls',
        type: 'ws',
        path: `/${wsPath}`,
        sni: domain
      });

      link = `${protocol}://${identifier}@${domain}:443?${params.toString()}#${encodeURIComponent(`${remark}-${clientEmail}`)}`;
    } else if (client.network_type === 'reality') {
      const identifier = client.protocol === 'vless' ? client.uuid : client.password;
      const protocol = client.protocol === 'vless' ? 'vless' : 'trojan';

      const params = new URLSearchParams({
        encryption: 'none',
        security: 'reality',
        sni: realityServerName,
        fp: 'chrome',
        pbk: realityPublicKey,
        sid: realityShortId,
        type: 'xhttp',
        path: '/'
      });

      link = `${protocol}://${identifier}@${tcpDomain}:${tcpPort}?${params.toString()}#${encodeURIComponent(`${remark}-${clientEmail}`)}`;
    }

    const qr = await QRCode.toBuffer(link, {
      type: 'png',
      width: 300,
      margin: 2,
      color: {
        dark: '#e0e0e0',
        light: '#1a1a1a'
      }
    });

    res.setHeader('Content-Type', 'image/png');
    res.send(qr);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Settings ─────────────────────────────────────────────
router.get('/api/settings', (req, res) => {
  try {
    const rows = stmts.getAllSettings.all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    // Mask private key for display
    if (settings.reality_private_key) {
      settings.reality_private_key_masked = settings.reality_private_key.slice(0, 8) + '...' + settings.reality_private_key.slice(-4);
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/settings', (req, res) => {
  try {
    const updates = req.body;
    const allowedKeys = [
      'reality_dest', 'reality_server_name', 'reality_short_id',
      'reality_private_key', 'reality_public_key', 'ws_path',
      'tcp_domain', 'tcp_port'
    ];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedKeys.includes(key)) {
        stmts.setSetting.run(key, value);
      }
    }

    const rows = stmts.getAllSettings.all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    reloadXray();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate new Reality keys
router.post('/api/settings/generate-reality', (req, res) => {
  try {
    const { generateX25519Keys } = require('./db');
    const keys = generateX25519Keys();
    const shortId = randomHex(8);

    stmts.setSetting.run('reality_private_key', keys.privateKey);
    stmts.setSetting.run('reality_public_key', keys.publicKey);
    stmts.setSetting.run('reality_short_id', shortId);

    reloadXray();
    res.json({
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
      shortId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Stats Reset ──────────────────────────────────────────
router.get('/api/stats/reset', (req, res) => {
  try {
    stmts.resetTraffic.run();
    res.json({ success: true, message: 'Traffic stats reset' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
