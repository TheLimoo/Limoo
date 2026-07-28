// src/routes.js
const express = require('express');
const QRCode = require('qrcode');
const config = require('./config');
const { db, stmts, generateUUID, randomHex, generateSubToken } = require('./db');
const { createSession, destroySession, requireAuth, verifyPassword } = require('./auth');
const { reloadXray, getStatus } = require('./xray-manager');
const { updateTrafficStats, getTrafficSummary, formatBytes } = require('./xray-stats');

const router = express.Router();

// ─── Helper: build WS-only client link ────────────────
function buildClientLinks(client, requestHost) {
  const wsPath = stmts.getSetting.get('ws_path')?.value || '0000000000000000';
  const panelDomain = stmts.getSetting.get('panel_domain')?.value || requestHost || 'localhost';
  const identifier = client.protocol === 'vless' ? client.uuid : client.password;
  const protocol = client.protocol === 'vless' ? 'vless' : 'trojan';
  const remark = client.inbound_remark || client.inbound_tag || 'limoo';
  const clientEmail = client.email || `user-${client.id}`;

  const params = new URLSearchParams({
    encryption: 'none',
    security: 'tls',
    type: 'ws',
    path: `/${wsPath}`,
    sni: panelDomain
  });

  return [`${protocol}://${identifier}@${panelDomain}:443?${params.toString()}#${encodeURIComponent(`${remark}-${clientEmail}`)}`];
}

// ─── Helper: render subscription page ─────────────────
function renderSubPage(client) {
  const up = client.up || 0;
  const down = client.down || 0;
  const total = up + down;
  const limitBytes = client.limit_bytes || 0;
  const limitFormatted = limitBytes > 0 ? formatBytes(limitBytes) : null;

  let statusText = 'فعال';
  let statusBadgeClass = 'sub-badge-active';
  const now = new Date();

  if (client.enabled !== 1) {
    statusBadgeClass = 'sub-badge-disabled';
    statusText = 'غیرفعال';
  } else if (client.expiry_date && new Date(client.expiry_date) < now) {
    statusBadgeClass = 'sub-badge-expired';
    statusText = 'منقضی شده';
  } else if (limitBytes > 0 && total > limitBytes) {
    statusBadgeClass = 'sub-badge-over';
    statusText = 'بیش از حد مجاز';
  }

  const percent = limitBytes > 0 ? Math.min(100, Math.round((total / limitBytes) * 100)) : 0;
  const expiryFormatted = client.expiry_date ? new Date(client.expiry_date).toLocaleDateString('fa-IR') : null;
  const qrUrl = `/api/public/client/${client.sub_token}/qr`;
  const panelDomain = stmts.getSetting.get('panel_domain')?.value || 'panel.example.com';
  const fullSubUrl = `https://${panelDomain}/sub/${client.sub_token}`;
  const initial = (client.email || 'U').charAt(0).toUpperCase();
  const protocolLabel = (client.protocol || 'vless').toUpperCase() + ' + WS';
  const remarkLabel = client.inbound_remark || client.inbound_tag || 'لیمو';

  let progressHtml = '';
  if (limitBytes > 0) {
    const fillClass = percent >= 90 ? 'sub-progress-danger' : (percent >= 70 ? 'sub-progress-warning' : '');
    progressHtml = `
        <div class="sub-stat-row">
          <span class="sub-stat-label">محدودیت حجم</span>
          <span class="sub-stat-value">${limitFormatted}</span>
        </div>
        <div class="sub-progress-wrap">
          <div class="sub-progress-bar">
            <div class="sub-progress-fill ${fillClass}" style="width:${percent}%"></div>
          </div>
          <span class="sub-progress-text">${percent}%</span>
        </div>`;
  }

  let expiryHtml = '';
  if (expiryFormatted) {
    expiryHtml = `
        <div class="sub-stat-row">
          <span class="sub-stat-label">تاریخ انقضا</span>
          <span class="sub-stat-value">${expiryFormatted}</span>
        </div>`;
  }

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0a0a0f">
  <title>وضعیت اشتراک | لیمو</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍋</text></svg>">
  <style>
    @keyframes fadeIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes fadeInUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
    @keyframes progressFill { from { width: 0; } }
    @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
    @keyframes countUp { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #0a0a0f;
      color: #f0f0f5;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Tahoma', sans-serif;
      direction: rtl;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    body::before {
      content: '';
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background:
        radial-gradient(ellipse at 20% 20%, rgba(102,126,234,0.1) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 80%, rgba(118,75,162,0.08) 0%, transparent 50%);
      pointer-events: none;
      z-index: 0;
    }

    .sub-card {
      position: relative;
      z-index: 1;
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 24px;
      padding: 0;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 16px 48px rgba(0,0,0,0.4);
      overflow: hidden;
      animation: fadeInUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .sub-header {
      position: relative;
      padding: 32px 28px 24px;
      text-align: center;
      background: linear-gradient(135deg, rgba(102,126,234,0.15) 0%, rgba(118,75,162,0.1) 100%);
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }

    .sub-avatar {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea, #764ba2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 800;
      color: white;
      margin: 0 auto 16px;
      box-shadow: 0 4px 20px rgba(102,126,234,0.35);
      animation: float 3s ease-in-out infinite;
    }

    .sub-client-name {
      font-size: 20px;
      font-weight: 800;
      margin-bottom: 8px;
      word-break: break-word;
    }

    .sub-badge {
      display: inline-block;
      padding: 4px 14px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.3px;
    }

    .sub-badge-active { background: rgba(34,197,94,0.15); color: #22c55e; animation: pulse 2s infinite; }
    .sub-badge-disabled { background: rgba(107,114,128,0.15); color: #9ca3af; }
    .sub-badge-expired { background: rgba(239,68,68,0.15); color: #ef4444; }
    .sub-badge-over { background: rgba(245,158,11,0.15); color: #f59e0b; }

    .sub-body { padding: 24px 28px; }

    .sub-stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .sub-stat-row:last-child { border-bottom: none; }

    .sub-stat-label { color: #8888aa; font-size: 13px; }
    .sub-stat-value {
      font-size: 14px;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
      direction: ltr;
    }

    .sub-traffic-values {
      display: flex;
      gap: 16px;
      padding: 16px;
      background: rgba(255,255,255,0.03);
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.05);
      margin-bottom: 16px;
    }

    .sub-traffic-item {
      flex: 1;
      text-align: center;
    }

    .sub-traffic-dir {
      font-size: 11px;
      color: #8888aa;
      margin-bottom: 4px;
    }

    .sub-traffic-val {
      font-size: 16px;
      font-weight: 800;
      font-family: 'JetBrains Mono', monospace;
      direction: ltr;
      animation: countUp 0.6s ease;
    }

    .sub-traffic-val.up { color: #22c55e; }
    .sub-traffic-val.down { color: #60a5fa; }

    .sub-progress-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 8px;
      margin-bottom: 16px;
    }

    .sub-progress-bar {
      flex: 1;
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
      height: 8px;
      overflow: hidden;
    }

    .sub-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #667eea, #764ba2);
      border-radius: 8px;
      transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
      animation: progressFill 1s ease;
    }

    .sub-progress-fill.sub-progress-warning { background: linear-gradient(90deg, #f59e0b, #f97316); }
    .sub-progress-fill.sub-progress-danger { background: linear-gradient(90deg, #ef4444, #dc2626); }

    .sub-progress-text {
      font-size: 11px;
      font-weight: 700;
      color: #8888aa;
      font-family: 'JetBrains Mono', monospace;
      min-width: 36px;
      text-align: left;
      direction: ltr;
    }

    .sub-protocol-row {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }

    .sub-protocol-badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
      background: rgba(102,126,234,0.12);
      color: #818cf8;
    }

    .sub-protocol-badge.ws {
      background: rgba(245,158,11,0.12);
      color: #fbbf24;
    }

    .sub-qr-container {
      text-align: center;
      margin: 16px 0;
    }

    .sub-qr-container img {
      max-width: 160px;
      border-radius: 14px;
      border: 2px solid rgba(255,255,255,0.06);
    }

    .sub-link-box {
      background: rgba(0,0,0,0.25);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px;
      padding: 14px;
      text-align: center;
      cursor: pointer;
      transition: all 0.25s ease;
      margin-top: 8px;
    }

    .sub-link-box:hover {
      border-color: rgba(102,126,234,0.3);
      background: rgba(102,126,234,0.06);
    }

    .sub-link-box:active { transform: scale(0.98); }

    .sub-link-label {
      font-size: 11px;
      color: #8888aa;
      margin-bottom: 6px;
    }

    .sub-link-url {
      font-size: 11px;
      font-family: 'JetBrains Mono', monospace;
      direction: ltr;
      word-break: break-all;
      color: #667eea;
      line-height: 1.6;
    }

    .sub-link-copied {
      color: #22c55e !important;
    }

    .sub-footer {
      padding: 16px 28px;
      border-top: 1px solid rgba(255,255,255,0.06);
      text-align: center;
      font-size: 11px;
      color: #555577;
    }

    .sub-footer span {
      background: linear-gradient(135deg, #667eea, #764ba2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-weight: 700;
    }

    @media (max-width: 480px) {
      body { padding: 12px; align-items: flex-start; padding-top: 24px; }
      .sub-card { border-radius: 20px; }
      .sub-header { padding: 24px 20px 20px; }
      .sub-body { padding: 20px; }
      .sub-avatar { width: 64px; height: 64px; font-size: 24px; }
      .sub-client-name { font-size: 18px; }
      .sub-traffic-val { font-size: 14px; }
      .sub-footer { padding: 12px 20px; }
    }
  </style>
</head>
<body>
  <div class="sub-card">
    <div class="sub-header">
      <div class="sub-avatar">${initial}</div>
      <div class="sub-client-name">${client.email || 'user-' + client.id}</div>
      <span class="sub-badge ${statusBadgeClass}">${statusText}</span>
    </div>

    <div class="sub-body">
      <div class="sub-traffic-values">
        <div class="sub-traffic-item">
          <div class="sub-traffic-dir">↑ آپلود</div>
          <div class="sub-traffic-val up">${formatBytes(up)}</div>
        </div>
        <div class="sub-traffic-item">
          <div class="sub-traffic-dir">↓ دانلود</div>
          <div class="sub-traffic-val down">${formatBytes(down)}</div>
        </div>
        <div class="sub-traffic-item">
          <div class="sub-traffic-dir">📊 کل مصرف</div>
          <div class="sub-traffic-val">${formatBytes(total)}</div>
        </div>
      </div>

      <div class="sub-stat-row">
        <span class="sub-stat-label">نام اینبند</span>
        <span class="sub-stat-value" style="font-family:inherit;direction:rtl;">${remarkLabel}</span>
      </div>

      ${progressHtml}
      ${expiryHtml}

      <div class="sub-protocol-row">
        <span class="sub-protocol-badge">${client.protocol || 'vless'}</span>
        <span class="sub-protocol-badge ws">WS</span>
      </div>

      <div class="sub-qr-container">
        <img src="${qrUrl}" alt="QR Code" onerror="this.parentElement.style.display='none'">
      </div>

      <div class="sub-link-box" onclick="copySubLink(this, '${fullSubUrl.replace(/'/g, "\\'")}')">
        <div class="sub-link-label">📋 لینک اشتراک — برای کپی کلیک کنید</div>
        <div class="sub-link-url">${fullSubUrl}</div>
      </div>
    </div>

    <div class="sub-footer">سرویس <span>لیمو</span> — پنل مدیریت پروکسی</div>
  </div>

  <script>
    function copySubLink(el, url) {
      navigator.clipboard.writeText(url).then(() => {
        var label = el.querySelector('.sub-link-label');
        var link = el.querySelector('.sub-link-url');
        label.textContent = '✓ لینک با موفقیت کپی شد';
        label.classList.add('sub-link-copied');
        link.classList.add('sub-link-copied');
        setTimeout(() => {
          label.textContent = '📋 لینک اشتراک — برای کپی کلیک کنید';
          label.classList.remove('sub-link-copied');
          link.classList.remove('sub-link-copied');
        }, 2000);
      }).catch(() => {
        var ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      });
    }
  </script>
</body>
</html>`;
}

// ─── Public Routes (NO auth) ──────────────────────────

router.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (!verifyPassword(password)) return res.status(401).json({ error: 'Invalid password' });
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

router.get('/sub/:token', (req, res) => {
  try {
    const client = db.prepare(
      'SELECT c.*, i.protocol, i.remark as inbound_remark FROM clients c JOIN inbounds i ON c.inbound_id = i.id WHERE c.sub_token = ? AND c.enabled = 1'
    ).get(req.params.token);
    if (!client) return res.status(404).send('Not found');

    const links = buildClientLinks(client, req.headers.host);
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
      'SELECT c.*, t.up, t.down, i.protocol, i.remark as inbound_remark FROM clients c LEFT JOIN traffic t ON c.id = t.client_id JOIN inbounds i ON c.inbound_id = i.id WHERE c.sub_token = ?'
    ).get(req.params.token);
    if (!client) return res.status(404).send('Not found');
    res.send(renderSubPage(client));
  } catch (err) {
    res.status(500).send('Error');
  }
});

router.get('/api/public/client/:token/qr', async (req, res) => {
  try {
    const client = db.prepare(
      'SELECT c.*, i.protocol, i.remark as inbound_remark FROM clients c JOIN inbounds i ON c.inbound_id = i.id WHERE c.sub_token = ?'
    ).get(req.params.token);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const links = buildClientLinks(client, req.headers.host);
    if (links.length === 0) return res.status(404).json({ error: 'No link' });

    const qr = await QRCode.toBuffer(links[0], {
      type: 'png', width: 300, margin: 2,
      color: { dark: '#e0e0e0', light: '#1a1a1a' }
    });
    res.setHeader('Content-Type', 'image/png');
    res.send(qr);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/public/client/:token', (req, res) => {
  try {
    const client = stmts.getClientByToken.get(req.params.token);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({
      email: client.email,
      enabled: client.enabled,
      limit_bytes: client.limit_bytes,
      expiry_date: client.expiry_date,
      up: client.up || 0,
      down: client.down || 0,
      total: (client.up || 0) + (client.down || 0),
      protocol: client.protocol,
      inbound_remark: client.inbound_remark,
      isExpired: client.expiry_date ? new Date(client.expiry_date) < new Date() : false,
      isOverLimit: client.limit_bytes > 0 && client.limit_bytes < (client.up || 0) + (client.down || 0),
      sub_token: client.sub_token
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Protected Routes ─────────────────────────────────
router.use('/api', requireAuth);

router.get('/api/status', (req, res) => {
  try { res.json(getStatus()); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/dashboard', (req, res) => {
  try {
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
        client_count: db.prepare('SELECT COUNT(*) as count FROM clients WHERE inbound_id = ?').get(i.id).count
      })),
      clients: traffic.clients
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Inbounds ─────────────────────────────────────────

router.get('/api/inbounds', (req, res) => {
  try {
    const inbounds = stmts.getAllInbounds.all();
    res.json(inbounds.map(i => ({
      ...i,
      client_count: db.prepare('SELECT COUNT(*) as count FROM clients WHERE inbound_id = ?').get(i.id).count
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/inbounds', (req, res) => {
  try {
    const { protocol, remark } = req.body;
    if (!protocol) return res.status(400).json({ error: 'protocol required' });
    if (!['vless', 'trojan'].includes(protocol)) {
      return res.status(400).json({ error: 'protocol must be vless or trojan' });
    }

    const tag = `ws-${protocol}-${randomHex(4)}`;
    const result = stmts.createInbound.run(tag, protocol, remark || '');
    const inbound = stmts.getInboundById.get(result.lastInsertRowid);
    reloadXray();
    res.json(inbound);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/inbounds/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { remark, enabled } = req.body;
    const inbound = stmts.getInboundById.get(id);
    if (!inbound) return res.status(404).json({ error: 'Inbound not found' });

    stmts.updateInbound.run(
      remark !== undefined ? remark : inbound.remark,
      enabled !== undefined ? (enabled ? 1 : 0) : inbound.enabled,
      id
    );

    const updated = stmts.getInboundById.get(id);
    reloadXray();
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/inbounds/:id', (req, res) => {
  try {
    const inbound = stmts.getInboundById.get(req.params.id);
    if (!inbound) return res.status(404).json({ error: 'Inbound not found' });
    stmts.deleteInbound.run(req.params.id);
    reloadXray();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Clients ──────────────────────────────────────────

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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/inbounds/:id/clients', (req, res) => {
  try {
    const inbound = stmts.getInboundById.get(req.params.id);
    if (!inbound) return res.status(404).json({ error: 'Inbound not found' });
    const clients = stmts.getClientsByInbound.all(req.params.id);
    res.json(clients.map(c => ({
      ...c,
      upFormatted: formatBytes(c.up || 0),
      downFormatted: formatBytes(c.down || 0),
      totalFormatted: formatBytes((c.up || 0) + (c.down || 0)),
      isExpired: c.expiry_date ? new Date(c.expiry_date) < new Date() : false,
      isOverLimit: c.limit_bytes > 0 && c.limit_bytes < (c.up || 0) + (c.down || 0)
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/inbounds/:id/clients', (req, res) => {
  try {
    const inbound = stmts.getInboundById.get(req.params.id);
    if (!inbound) return res.status(404).json({ error: 'Inbound not found' });

    const { email, limit_bytes, expiry_date, enabled } = req.body;
    const uuid = inbound.protocol === 'vless' ? generateUUID() : null;
    const password = inbound.protocol === 'trojan' ? randomHex(16) : null;
    const sub_token = generateSubToken();

    const result = stmts.createClient.run(
      req.params.id, uuid, password, email || '',
      limit_bytes || 0, expiry_date || null,
      enabled !== undefined ? (enabled ? 1 : 0) : 1, sub_token
    );

    stmts.upsertTraffic.run(result.lastInsertRowid, 0, 0, 0);
    const client = stmts.getClientById.get(result.lastInsertRowid);
    reloadXray();
    res.json(client);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/clients/:id', (req, res) => {
  try {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { email, limit_bytes, expiry_date, enabled } = req.body;
    stmts.updateClient.run(
      email !== undefined ? email : client.email,
      limit_bytes !== undefined ? limit_bytes : client.limit_bytes,
      expiry_date !== undefined ? expiry_date : client.expiry_date,
      enabled !== undefined ? (enabled ? 1 : 0) : client.enabled,
      req.params.id
    );

    const updated = stmts.getClientById.get(req.params.id);
    reloadXray();
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/clients/:id', (req, res) => {
  try {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    stmts.deleteClient.run(req.params.id);
    reloadXray();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/clients/:id/link', (req, res) => {
  try {
    const client = stmts.getClientById.get(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const links = buildClientLinks(client, req.headers.host);
    res.json({ link: links[0] || '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/clients/:id/qr', async (req, res) => {
  try {
    const client = stmts.getClientById.get(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const links = buildClientLinks(client, req.headers.host);
    if (links.length === 0) return res.status(404).json({ error: 'No link' });

    const qr = await QRCode.toBuffer(links[0], {
      type: 'png', width: 300, margin: 2,
      color: { dark: '#e0e0e0', light: '#1a1a1a' }
    });
    res.setHeader('Content-Type', 'image/png');
    res.send(qr);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Settings ─────────────────────────────────────────

router.get('/api/settings', (req, res) => {
  try {
    const rows = stmts.getAllSettings.all();
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    res.json(settings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/settings', (req, res) => {
  try {
    const updates = req.body;
    const allowedKeys = ['panel_domain'];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedKeys.includes(key)) {
        stmts.setSetting.run(key, value);
      }
    }

    const rows = stmts.getAllSettings.all();
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;

    reloadXray();
    res.json(settings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Stats Reset ──────────────────────────────────────

router.get('/api/stats/reset', (req, res) => {
  try {
    stmts.resetTraffic.run();
    res.json({ success: true, message: 'Traffic stats reset' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
