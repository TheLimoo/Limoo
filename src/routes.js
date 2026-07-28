// src/routes.js
const express = require('express');
const QRCode = require('qrcode');
const config = require('./config');
const { db, stmts, generateUUID, randomHex, generateSubToken } = require('./db');
const { createSession, destroySession, requireAuth, verifyPassword } = require('./auth');
const { reloadXray, getStatus } = require('./xray-manager');
const { updateTrafficStats, getTrafficSummary, formatBytes } = require('./xray-stats');

const router = express.Router();

// ─── Helper: build vless/trojan links for a client ──────
function buildClientLinks(client) {
  const links = [];

  const wsPath = stmts.getSetting.get('ws_path')?.value || '0000000000000000';
  const realityServerName = stmts.getSetting.get('reality_server_name')?.value || 'www.microsoft.com';
  const realityPublicKey = stmts.getSetting.get('reality_public_key')?.value || '';
  const realityShortId = stmts.getSetting.get('reality_short_id')?.value || '00000000';

  // Use panel_domain setting if available, otherwise fallback
  const panelDomain = stmts.getSetting.get('panel_domain')?.value || '';
  // For Reality: use per-inbound address if set, otherwise fallback to global
  const tcpDomain = client.inbound_address || stmts.getSetting.get('tcp_domain')?.value || panelDomain || 'localhost';
  const tcpPort = parseInt(stmts.getSetting.get('tcp_port')?.value || '443', 10);

  const identifier = client.protocol === 'vless' ? client.uuid : client.password;
  const protocol = client.protocol === 'vless' ? 'vless' : 'trojan';
  const remark = client.inbound_remark || client.inbound_tag || 'limoo';
  const clientEmail = client.email || `user-${client.id}`;

  if (client.network_type === 'ws') {
    const domain = panelDomain || 'localhost';
    const params = new URLSearchParams({
      encryption: 'none',
      security: 'tls',
      type: 'ws',
      path: `/${wsPath}`,
      sni: domain
    });
    links.push(`${protocol}://${identifier}@${domain}:443?${params.toString()}#${encodeURIComponent(`${remark}-${clientEmail}`)}`);
  } else if (client.network_type === 'reality') {
    // Use per-inbound host if available
    const host = client.host || '';
    const sni = (host === '' || host === '*') ? realityServerName : host;

    const params = new URLSearchParams({
      encryption: 'none',
      security: 'reality',
      sni: sni,
      fp: 'chrome',
      pbk: realityPublicKey,
      sid: realityShortId,
      type: 'xhttp',
      path: '/'
    });
    links.push(`${protocol}://${identifier}@${tcpDomain}:${tcpPort}?${params.toString()}#${encodeURIComponent(`${remark}-${clientEmail}`)}`);
  }

  return links;
}

// ─── Helper: render subscription page HTML ───────────────
function renderSubPage(client) {
  const up = client.up || 0;
  const down = client.down || 0;
  const total = up + down;
  const limitBytes = client.limit_bytes || 0;
  const limitFormatted = limitBytes > 0 ? formatBytes(limitBytes) : null;
  const totalFormatted = formatBytes(total);
  const upFormatted = formatBytes(up);
  const downFormatted = formatBytes(down);

  // Determine status
  let statusClass = 'status-active';
  let status = 'فعال';
  const now = new Date();

  if (client.enabled !== 1) {
    statusClass = 'status-expired';
    status = 'غیرفعال';
  } else if (client.expiry_date && new Date(client.expiry_date) < now) {
    statusClass = 'status-expired';
    status = 'منقضی شده';
  } else if (limitBytes > 0 && total > limitBytes) {
    statusClass = 'status-over';
    status = 'بیش از حد مجاز';
  }

  // Progress bar percentage
  const percent = limitBytes > 0 ? Math.min(100, Math.round((total / limitBytes) * 100)) : 0;

  // Format expiry
  const expiryFormatted = client.expiry_date ? new Date(client.expiry_date).toLocaleDateString('fa-IR') : null;

  // Build QR code URL
  const qrUrl = `/api/public/client/${client.sub_token}/qr`;

  // Build subscription link
  const subUrl = `/sub/${client.sub_token}`;
  const panelDomain = stmts.getSetting.get('panel_domain')?.value || 'panel.example.com';
  const fullSubUrl = `https://${panelDomain}${subUrl}`;

  let html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>وضعیت اشتراک | لیمو</title>
  <style>
    body { background: #0f0f0f; color: #e0e0e0; font-family: system-ui; display: flex; justify-content: center; padding: 20px; }
    .card { background: #1a1a1a; border-radius: 16px; padding: 24px; max-width: 400px; width: 100%; }
    .stat { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #222; }
    .stat-label { color: #888; }
    .stat-value { color: #4f46e5; font-weight: bold; }
    .status-active { color: #22c55e; }
    .status-expired { color: #ef4444; }
    .status-over { color: #f59e0b; }
    .logo { text-align: center; font-size: 48px; margin-bottom: 8px; }
    .title { text-align: center; color: #4f46e5; margin-bottom: 16px; }
    .progress-bar { background: #333; border-radius: 8px; height: 8px; overflow: hidden; margin-top: 4px; }
    .progress-fill { height: 100%; background: #4f46e5; border-radius: 8px; transition: width 0.3s; }
    .qr-container { text-align: center; margin-top: 16px; }
    .qr-container img { max-width: 150px; border-radius: 12px; }
    .sub-link { background: #0a0a0a; border: 1px solid #333; border-radius: 8px; padding: 10px; word-break: break-all; font-size: 12px; color: #4f46e5; margin-top: 12px; cursor: pointer; text-align: center; }
    .sub-link:hover { border-color: #4f46e5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🍋</div>
    <div class="title">وضعیت اشتراک</div>
    <div class="stat"><span class="stat-label">نام</span><span class="stat-value">${client.email || 'user-' + client.id}</span></div>
    <div class="stat"><span class="stat-label">وضعیت</span><span class="stat-value ${statusClass}">${status}</span></div>
    <div class="stat"><span class="stat-label">آپلود</span><span class="stat-value">↑ ${upFormatted}</span></div>
    <div class="stat"><span class="stat-label">دانلود</span><span class="stat-value">↓ ${downFormatted}</span></div>
    <div class="stat"><span class="stat-label">حجم مصرفی</span><span class="stat-value">${totalFormatted}</span></div>`;

  if (limitFormatted) {
    html += `
    <div class="stat"><span class="stat-label">محدودیت</span><span class="stat-value">${limitFormatted}</span></div>
    <div style="margin-top:8px;">
      <div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div>
    </div>`;
  }

  if (expiryFormatted) {
    html += `
    <div class="stat"><span class="stat-label">انقضا</span><span class="stat-value">${expiryFormatted}</span></div>`;
  }

  html += `
    <div class="stat"><span class="stat-label">پروتکل</span><span class="stat-value">${client.protocol.toUpperCase()} + ${client.network_type.toUpperCase()}</span></div>
    <div class="qr-container">
      <img src="${qrUrl}" alt="QR Code" onerror="this.style.display='none'">
    </div>
    <div class="sub-link" onclick="navigator.clipboard.writeText('${fullSubUrl}').then(()=>this.style.color='#22c55e')">📋 لینک اشتراک: ${fullSubUrl}</div>
  </div>
</body>
</html>`;

  return html;
}

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

// ─── Public Subscription Routes (NO auth required) ───────
router.get('/sub/:token', (req, res) => {
  try {
    const client = db.prepare(
      'SELECT c.*, i.protocol, i.network_type, i.port as inbound_port, i.host, i.dest, i.address as inbound_address FROM clients c JOIN inbounds i ON c.inbound_id = i.id WHERE c.sub_token = ? AND c.enabled = 1'
    ).get(req.params.token);
    if (!client) return res.status(404).send('Not found');

    // Build config links
    const links = buildClientLinks(client);
    const base64 = Buffer.from(links.join('\n')).toString('base64');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="limoo-sub.txt"');
    res.send(base64);
  } catch (err) {
    res.status(500).send('Error');
  }
});

router.get('/subpage/:token', (req, res) => {
  try {
    const client = db.prepare(
      'SELECT c.*, t.up, t.down, i.protocol, i.network_type, i.remark as inbound_remark FROM clients c LEFT JOIN traffic t ON c.id = t.client_id JOIN inbounds i ON c.inbound_id = i.id WHERE c.sub_token = ?'
    ).get(req.params.token);
    if (!client) return res.status(404).send('Not found');

    res.send(renderSubPage(client));
  } catch (err) {
    res.status(500).send('Error');
  }
});

// Public QR code for subscription page
router.get('/api/public/client/:token/qr', async (req, res) => {
  try {
    const client = db.prepare(
      'SELECT c.*, i.protocol, i.network_type, i.host, i.remark as inbound_remark FROM clients c JOIN inbounds i ON c.inbound_id = i.id WHERE c.sub_token = ?'
    ).get(req.params.token);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const links = buildClientLinks(client);
    if (links.length === 0) return res.status(404).json({ error: 'No link' });

    const qr = await QRCode.toBuffer(links[0], {
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

// Public client info endpoint
router.get('/api/public/client/:token', (req, res) => {
  try {
    const client = stmts.getClientByToken.get(req.params.token);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Return without sensitive data
    res.json({
      email: client.email,
      enabled: client.enabled,
      limit_bytes: client.limit_bytes,
      expiry_date: client.expiry_date,
      up: client.up || 0,
      down: client.down || 0,
      total: (client.up || 0) + (client.down || 0),
      protocol: client.protocol,
      network_type: client.network_type,
      inbound_remark: client.inbound_remark,
      isExpired: client.expiry_date ? new Date(client.expiry_date) < new Date() : false,
      isOverLimit: client.limit_bytes > 0 && client.limit_bytes < (client.up || 0) + (client.down || 0),
      sub_token: client.sub_token
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    const { protocol, network_type, remark, port, host, dest, address } = req.body;
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
    const result = stmts.createInbound.run(
      tag,
      protocol,
      network_type,
      remark || '',
      port || 0,
      host || '',
      dest || '',
      address || ''
    );

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
    const { remark, enabled, port, host, dest, address } = req.body;
    const inbound = stmts.getInboundById.get(id);
    if (!inbound) {
      return res.status(404).json({ error: 'Inbound not found' });
    }

    stmts.updateInbound.run(
      remark !== undefined ? remark : inbound.remark,
      enabled !== undefined ? (enabled ? 1 : 0) : inbound.enabled,
      port !== undefined ? port : (inbound.port || 0),
      host !== undefined ? host : (inbound.host || ''),
      dest !== undefined ? dest : (inbound.dest || ''),
      address !== undefined ? address : (inbound.address || ''),
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
router.get('/api/clients', (req, res) => {
  try {
    const clients = stmts.getAllClients.all();
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
    const sub_token = generateSubToken();

    const result = stmts.createClient.run(
      id,
      uuid,
      password,
      email || '',
      limit_bytes || 0,
      expiry_date || null,
      enabled !== undefined ? (enabled ? 1 : 0) : 1,
      sub_token
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

    const links = buildClientLinks(client);
    res.json({ link: links[0] || '' });
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

    const links = buildClientLinks(client);
    if (links.length === 0) return res.status(404).json({ error: 'No link' });

    const qr = await QRCode.toBuffer(links[0], {
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
      'tcp_domain', 'tcp_port', 'panel_domain'
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
