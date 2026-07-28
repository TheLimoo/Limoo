// ─── app.js — Limoo Frontend ─────────────────────────────
// Single-page application for the Limoo proxy panel

(function() {
  'use strict';

  // ─── State ────────────────────────────────────────────
  let currentPage = 'dashboard';
  let currentInboundId = null;
  let dashboardData = null;

  // ─── Utilities ────────────────────────────────────────
  function $(selector) {
    return document.querySelector(selector);
  }

  function $$(selector) {
    return document.querySelectorAll(selector);
  }

  async function api(url, options = {}) {
    const defaults = {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    };
    const config = { ...defaults, ...options };
    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, config);
      if (response.status === 401) {
        showLogin();
        throw new Error('Unauthorized');
      }
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }
      return data;
    } catch (err) {
      if (err.message !== 'Unauthorized') {
        throw err;
      }
      throw err;
    }
  }

  // ─── Toast Notifications ──────────────────────────────
  function showToast(message, type = 'info') {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 3500);
  }

  // ─── Loading ──────────────────────────────────────────
  function showLoading() {
    $('#loading-overlay').classList.remove('hidden');
  }

  function hideLoading() {
    $('#loading-overlay').classList.add('hidden');
  }

  // ─── Modal ────────────────────────────────────────────
  let modalConfirmCallback = null;

  function showModal(title, message, onConfirm, confirmText = 'تأیید') {
    $('#modal-title').textContent = title;
    $('#modal-message').textContent = message;
    const confirmBtn = $('#modal-confirm');
    confirmBtn.textContent = confirmText;
    confirmBtn.className = 'btn btn-danger';
    modalConfirmCallback = onConfirm;
    $('#modal-overlay').classList.remove('hidden');
  }

  window.closeModal = function() {
    $('#modal-overlay').classList.add('hidden');
    modalConfirmCallback = null;
  };

  // Modal confirm button handler
  document.addEventListener('DOMContentLoaded', () => {
    $('#modal-confirm').addEventListener('click', () => {
      if (modalConfirmCallback) {
        modalConfirmCallback();
      }
      closeModal();
    });
  });

  // ─── Navigation ───────────────────────────────────────
  window.navigateTo = function(page, data) {
    currentPage = page;

    // Hide all views
    $$('.view').forEach(v => {
      v.classList.remove('active');
      v.classList.add('hidden');
    });

    // Update nav
    $$('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = $(`.nav-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');

    // Show target view
    if (page === 'inbound-detail' && data) {
      currentInboundId = data;
      const view = $('#view-inbound-detail');
      view.classList.remove('hidden');
      view.classList.add('active');
      loadInboundDetail(data);
    } else {
      const targetView = $(`#view-${page}`);
      if (targetView) {
        targetView.classList.remove('hidden');
        targetView.classList.add('active');
      }
    }

    // Load data
    switch (page) {
      case 'dashboard':
        loadDashboard();
        break;
      case 'inbounds':
        loadInbounds();
        break;
      case 'clients':
        loadAllClients();
        break;
      case 'settings':
        loadSettings();
        break;
    }

    // Close sidebar on mobile
    $('#sidebar').classList.remove('open');
  };

  window.toggleSidebar = function() {
    $('#sidebar').classList.toggle('open');
  };

  // ─── Login / Logout ──────────────────────────────────
  window.showLogin = function() {
    $('#login-page').classList.remove('hidden');
    $('#app-page').classList.add('hidden');
    $('#password').value = '';
    $('#login-error').classList.add('hidden');
  };

  function showApp() {
    $('#login-page').classList.add('hidden');
    $('#app-page').classList.remove('hidden');
    navigateTo('dashboard');
  }

  window.logout = async function() {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch (e) {}
    showLogin();
  };

  // Login form
  document.addEventListener('DOMContentLoaded', () => {
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = $('#password').value;

      try {
        showLoading();
        await api('/api/login', {
          method: 'POST',
          body: { password }
        });
        hideLoading();
        showApp();
      } catch (err) {
        hideLoading();
        const errEl = $('#login-error');
        errEl.textContent = 'رمز عبور اشتباه است';
        errEl.classList.remove('hidden');
      }
    });
  });

  // ─── Dashboard ────────────────────────────────────────
  window.loadDashboard = async function() {
    try {
      const data = await api('/api/dashboard');
      dashboardData = data;

      // Update stats
      $('#stat-upload').textContent = data.stats.totalUpFormatted;
      $('#stat-download').textContent = data.stats.totalDownFormatted;
      $('#stat-inbounds').textContent = `${data.stats.enabledInbounds}/${data.stats.totalInbounds}`;
      $('#stat-clients').textContent = data.stats.totalClients;

      // Update xray status
      try {
        const status = await api('/api/status');
        updateStatusBadge(status);
      } catch (e) {}

      // Render inbounds list on dashboard
      renderInboundsList('inbounds-list-dashboard', data.inbounds, true);
    } catch (err) {
      showToast('خطا در بارگذاری داشبورد: ' + err.message, 'error');
    }
  };

  function updateStatusBadge(status) {
    const badge = $('#xray-status');
    if (status.running) {
      badge.className = 'status-badge status-running';
      badge.innerHTML = `<span class="status-dot"></span> فعال`;
    } else {
      badge.className = 'status-badge status-stopped';
      badge.innerHTML = `<span class="status-dot"></span> غیرفعال`;
    }
  }

  // ─── Inbounds ─────────────────────────────────────────
  window.loadInbounds = async function() {
    try {
      const inbounds = await api('/api/inbounds');
      renderInboundsList('inbounds-list', inbounds, false);
    } catch (err) {
      showToast('خطا در بارگذاری اینباندها: ' + err.message, 'error');
    }
  };

  function renderInboundsList(containerId, inbounds, compact) {
    const container = $(`#${containerId}`);

    if (!inbounds || inbounds.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔗</div>
          <div class="empty-state-text">هیچ اینبندی وجود ندارد</div>
        </div>
      `;
      return;
    }

    container.innerHTML = inbounds.map(inbound => `
      <div class="list-item list-item-clickable" onclick="navigateTo('inbound-detail', ${inbound.id})">
        <div class="list-item-info">
          <span class="list-item-badge badge-${inbound.protocol}">${inbound.protocol.toUpperCase()}</span>
          <span class="list-item-badge badge-${inbound.network_type}">${inbound.network_type.toUpperCase()}</span>
          <div>
            <div class="list-item-name">${inbound.remark || inbound.tag}</div>
            <div class="list-item-meta">${inbound.client_count || 0} کلاینت • ${inbound.tag}</div>
            ${inbound.port ? `<div class="list-item-meta" style="font-size:11px;color:#666;">پورت: ${inbound.port}</div>` : ''}
          </div>
        </div>
        <div class="list-item-actions">
          <span class="list-item-badge ${inbound.enabled ? 'badge-enabled' : 'badge-disabled'}">
            ${inbound.enabled ? 'فعال' : 'غیرفعال'}
          </span>
        </div>
      </div>
    `).join('');
  }

  // ─── Add Inbound ──────────────────────────────────────
  window.showAddInboundModal = function() {
    $('#inbound-protocol').value = 'vless';
    $('#inbound-network-type').value = 'ws';
    $('#inbound-remark').value = '';
    $('#inbound-port').value = '0';
    $('#inbound-host').value = '';
    $('#inbound-dest').value = '';
    $('#inbound-reality-fields').classList.add('hidden');
    toggleInboundNetworkFields();
    $('#add-inbound-modal').classList.remove('hidden');
  };

  window.toggleInboundNetworkFields = function() {
    const isReality = $('#inbound-network-type').value === 'reality';
    const fields = $('#inbound-reality-fields');
    if (isReality) {
      fields.classList.remove('hidden');
      loadRealityDefaults();
    } else {
      fields.classList.add('hidden');
    }
  };

  window.loadRealityDefaults = async function() {
    try {
      const settings = await api('/api/settings');
      const defaultsHtml = `
        <div>Dest: ${settings.reality_dest || '...'}</div>
        <div>SNI: ${settings.reality_server_name || '...'}</div>
        <div>Short ID: ${settings.reality_short_id || '...'}</div>
      `;
      $('#inbound-reality-defaults').innerHTML = defaultsHtml;
    } catch (e) {}
  };

  window.closeAddInboundModal = function() {
    $('#add-inbound-modal').classList.add('hidden');
  };

  window.createInbound = async function() {
    const protocol = $('#inbound-protocol').value;
    const network_type = $('#inbound-network-type').value;
    const remark = $('#inbound-remark').value.trim();
    const port = parseInt($('#inbound-port').value) || 0;
    const host = $('#inbound-host').value.trim();
    const dest = $('#inbound-dest').value.trim();

    try {
      showLoading();
      await api('/api/inbounds', {
        method: 'POST',
        body: { protocol, network_type, remark, port, host, dest }
      });
      hideLoading();
      closeAddInboundModal();
      showToast('اینبند با موفقیت ایجاد شد', 'success');
      if (currentPage === 'dashboard') loadDashboard();
      else if (currentPage === 'inbounds') loadInbounds();
    } catch (err) {
      hideLoading();
      showToast('خطا در ایجاد اینبند: ' + err.message, 'error');
    }
  };

  // ─── Delete Inbound ───────────────────────────────────
  window.confirmDeleteInbound = function() {
    showModal(
      'حذف اینبند',
      'آیا مطمئن هستید که می‌خواهید این اینبند و تمام کلاینت‌های آن را حذف کنید؟ این عمل غیرقابل بازگشت است.',
      deleteInbound,
      'حذف'
    );
  };

  async function deleteInbound() {
    try {
      showLoading();
      await api(`/api/inbounds/${currentInboundId}`, { method: 'DELETE' });
      hideLoading();
      showToast('اینبند حذف شد', 'success');
      navigateTo('inbounds');
    } catch (err) {
      hideLoading();
      showToast('خطا در حذف اینبند: ' + err.message, 'error');
    }
  }

  // ─── Inbound Detail ───────────────────────────────────
  window.loadInboundDetail = async function(inboundId) {
    try {
      const inbounds = await api('/api/inbounds');
      const inbound = inbounds.find(i => i.id === inboundId);
      if (!inbound) {
        showToast('اینبند یافت نشد', 'error');
        navigateTo('inbounds');
        return;
      }

      $('#inbound-detail-title').textContent = inbound.remark || inbound.tag;

      // Show connection info
      const settings = await api('/api/settings');
      let infoHtml = '';
      if (inbound.network_type === 'ws') {
        const domain = settings.panel_domain || window.location.hostname;
        infoHtml = `
          <div class="card" style="border:1px solid #333;margin-bottom:16px;">
            <div class="card-body" style="padding:12px;">
              <p style="color:#999;font-size:12px;margin:0 0 8px 0;">⚡ اطلاعات اتصال WebSocket</p>
              <div style="display:flex;flex-direction:column;gap:4px;font-size:13px;">
                <div><span style="color:#666;">دامنه:</span> <span style="color:#4f46e5;">${domain}:443</span></div>
                <div><span style="color:#666;">مسیر:</span> <span style="color:#4f46e5;">/${settings.ws_path || '...'}</span></div>
                <div><span style="color:#666;">پروتکل:</span> <span style="color:#4f46e5;">${inbound.protocol.toUpperCase()}</span></div>
              </div>
            </div>
          </div>`;
      } else if (inbound.network_type === 'reality') {
        const dest = inbound.dest || settings.reality_dest || '...';
        const host = inbound.host || '(catch-all)';
        const port = inbound.port || 443;
        infoHtml = `
          <div class="card" style="border:1px solid #333;margin-bottom:16px;">
            <div class="card-body" style="padding:12px;">
              <p style="color:#999;font-size:12px;margin:0 0 8px 0;">⚡ اطلاعات اتصال REALITY</p>
              <div style="display:flex;flex-direction:column;gap:4px;font-size:13px;">
                <div><span style="color:#666;">Dest:</span> <span style="color:#4f46e5;">${dest}</span></div>
                <div><span style="color:#666;">SNI Host:</span> <span style="color:#4f46e5;">${host}</span></div>
                <div><span style="color:#666;">Port:</span> <span style="color:#4f46e5;">${port}</span></div>
                <div><span style="color:#666;">Public Key:</span> <span style="color:#4f46e5;font-size:11px;">${settings.reality_public_key || '...'}</span></div>
                <div><span style="color:#666;">Short ID:</span> <span style="color:#4f46e5;">${settings.reality_short_id || '...'}</span></div>
              </div>
            </div>
          </div>`;
      }

      // Insert info before clients list
      const clientsCard = $('#clients-list').closest('.card');
      const existingInfo = clientsCard.previousElementSibling;
      if (existingInfo && existingInfo.id === 'inbound-info-box') existingInfo.remove();
      if (infoHtml) {
        const temp = document.createElement('div');
        temp.id = 'inbound-info-box';
        temp.innerHTML = infoHtml;
        clientsCard.parentNode.insertBefore(temp, clientsCard);
      }

      const clients = await api(`/api/inbounds/${inboundId}/clients`);
      renderClientsList(clients, inbound);
    } catch (err) {
      showToast('خطا در بارگذاری جزئیات: ' + err.message, 'error');
    }
  };

  function renderClientsList(clients, inbound) {
    const container = $('#clients-list');

    if (!clients || clients.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👥</div>
          <div class="empty-state-text">هیچ کلاینتی وجود ندارد</div>
          <div class="empty-state-text" style="font-size:12px;color:#666;">روی "+ اضافه کردن کلاینت" بزنید</div>
        </div>
      `;
      return;
    }

    container.innerHTML = clients.map(client => {
      const isExpired = client.isExpired;
      const isOverLimit = client.isOverLimit;
      const isDisabled = client.enabled !== 1;

      let statusBadges = '';
      if (isDisabled) statusBadges += '<span class="list-item-badge badge-disabled">غیرفعال</span>';
      if (isExpired) statusBadges += '<span class="list-item-badge badge-expired">منقضی</span>';
      if (isOverLimit) statusBadges += '<span class="list-item-badge badge-expired">overflow</span>';

      // Sub token display (truncated)
      const subToken = client.sub_token || '';
      const subTokenShort = subToken.length > 12 ? subToken.substring(0, 12) + '...' : subToken;

      return `
        <div class="list-item" style="flex-direction:column;align-items:stretch;gap:8px;">
          <div class="list-item-info">
            <div style="flex:1;min-width:0">
              <div class="list-item-name">${client.email || 'user-' + client.id}</div>
              <div class="list-item-meta">
                <span class="traffic-info">
                  <span class="traffic-up">↑${client.upFormatted || '0 B'}</span> •
                  <span class="traffic-down">↓${client.downFormatted || '0 B'}</span>
                </span>
                ${client.expiry_date ? ` • انقضا: ${new Date(client.expiry_date).toLocaleDateString('fa-IR')}` : ''}
                ${client.limit_bytes > 0 ? ` • لیمیت: ${formatBytesJS(client.limit_bytes)}` : ''}
              </div>
              ${subToken ? `
              <div style="margin-top:4px;font-size:11px;display:flex;align-items:center;gap:8px;">
                <span style="color:#666;">🔑</span>
                <span style="color:#888;font-family:monospace;direction:ltr;" title="${subToken}">${subTokenShort}</span>
                <button class="btn btn-secondary btn-sm" style="padding:2px 6px;font-size:10px;" onclick="event.stopPropagation();copyToClipboard(this.parentElement.querySelector('span[title]'))" data-copy="${subToken}">📋</button>
              </div>` : ''}
              <div style="margin-top:4px">${statusBadges}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" onclick="showClientLink(${client.id})" style="flex:1;min-width:100px;">🔗 لینک اشتراک</button>
            <button class="btn btn-secondary btn-sm" onclick="showClientQR(${client.id}, '${(client.email || '').replace(/'/g, "\\'")}')">📷 QR</button>
            ${subToken ? `<button class="btn btn-secondary btn-sm" onclick="window.open('/subpage/${subToken}', '_blank')" title="صفحه وضعیت کلاینت">📋 وضعیت</button>` : ''}
            <button class="btn btn-secondary btn-sm" onclick="showEditClientModal(${client.id}, '${(client.email || '').replace(/'/g, "\\'")}', ${client.limit_bytes || 0}, '${client.expiry_date || ''}', ${client.enabled})">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="confirmDeleteClient(${client.id})">🗑</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function formatBytesJS(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // ─── Global Clients List ──────────────────────────────
  window.loadAllClients = async function() {
    try {
      const clients = await api('/api/clients');
      renderAllClientsList(clients);
    } catch (err) {
      showToast('خطا در بارگذاری کلاینت‌ها: ' + err.message, 'error');
    }
  };

  function renderAllClientsList(clients) {
    const container = $('#all-clients-list');

    if (!clients || clients.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👥</div>
          <div class="empty-state-text">هیچ کلاینتی وجود ندارد</div>
          <div class="empty-state-text" style="font-size:12px;color:#666;">از بخش اینباندها کلاینت اضافه کنید</div>
        </div>
      `;
      return;
    }

    container.innerHTML = clients.map(client => {
      const isExpired = client.isExpired;
      const isOverLimit = client.isOverLimit;
      const isDisabled = client.enabled !== 1;

      let statusBadges = '';
      if (isDisabled) statusBadges += '<span class="list-item-badge badge-disabled">غیرفعال</span>';
      if (isExpired) statusBadges += '<span class="list-item-badge badge-expired">منقضی</span>';
      if (isOverLimit) statusBadges += '<span class="list-item-badge badge-expired">overflow</span>';

      const subToken = client.sub_token || '';
      const subTokenShort = subToken.length > 12 ? subToken.substring(0, 12) + '...' : subToken;

      return `
        <div class="list-item" style="flex-direction:column;align-items:stretch;gap:8px;">
          <div class="list-item-info">
            <div style="flex:1;min-width:0">
              <div class="list-item-name">${client.email || 'user-' + client.id}</div>
              <div class="list-item-meta">
                <span class="list-item-badge badge-${client.protocol}" style="margin-left:4px;">${(client.protocol || '').toUpperCase()}</span>
                <span class="list-item-badge badge-${client.network_type}">${(client.network_type || '').toUpperCase()}</span>
                <span style="margin-right:4px;color:#666;font-size:12px;">اینبند: ${client.inbound_remark || client.inbound_tag}</span>
              </div>
              <div class="list-item-meta">
                <span class="traffic-info">
                  <span class="traffic-up">↑${client.upFormatted || '0 B'}</span> •
                  <span class="traffic-down">↓${client.downFormatted || '0 B'}</span>
                </span>
                ${client.expiry_date ? ` • انقضا: ${new Date(client.expiry_date).toLocaleDateString('fa-IR')}` : ''}
                ${client.limit_bytes > 0 ? ` • لیمیت: ${formatBytesJS(client.limit_bytes)}` : ''}
              </div>
              ${subToken ? `
              <div style="margin-top:4px;font-size:11px;display:flex;align-items:center;gap:8px;">
                <span style="color:#666;">🔑</span>
                <span style="color:#888;font-family:monospace;direction:ltr;" title="${subToken}">${subTokenShort}</span>
                <button class="btn btn-secondary btn-sm" style="padding:2px 6px;font-size:10px;" onclick="event.stopPropagation();copyToClipboard(this.parentElement.querySelector('span[title]'))" data-copy="${subToken}">📋</button>
              </div>` : ''}
              <div style="margin-top:4px">${statusBadges}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" onclick="showClientLink(${client.id})" style="flex:1;min-width:100px;">🔗 لینک اشتراک</button>
            <button class="btn btn-secondary btn-sm" onclick="showClientQR(${client.id}, '${(client.email || '').replace(/'/g, "\\'")}')">📷 QR</button>
            ${subToken ? `<button class="btn btn-secondary btn-sm" onclick="window.open('/subpage/${subToken}', '_blank')" title="صفحه وضعیت کلاینت">📋 وضعیت</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // ─── Client Link ──────────────────────────────────────
  window.showClientLink = async function(clientId) {
    try {
      const data = await api(`/api/clients/${clientId}/link`);
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-header">
            <h3>🔗 لینک اشتراک</h3>
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
          </div>
          <div class="modal-body">
            <div class="link-display" style="background:#0a0a0a;border:1px solid #333;border-radius:8px;padding:12px;word-break:break-all;font-size:13px;color:#4f46e5;cursor:pointer;" onclick="copyLink('${data.link.replace(/'/g, "\\'")}')">
              ${data.link}
            </div>
            <p style="text-align:center;margin-top:8px;font-size:12px;color:#666;">روی لینک بزنید تا کپی شود</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-primary" onclick="copyLink('${data.link.replace(/'/g, "\\'")}')">📋 کپی لینک</button>
            <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">بستن</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    } catch (err) {
      showToast('خطا در دریافت لینک: ' + err.message, 'error');
    }
  };

  window.copyLink = function(link) {
    navigator.clipboard.writeText(link).then(() => {
      showToast('لینک کپی شد', 'success');
    }).catch(() => {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = link;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      showToast('لینک کپی شد', 'success');
    });
  };

  // ─── QR Code ──────────────────────────────────────────
  window.showClientQR = function(clientId, email) {
    const img = $('#qr-image');
    img.src = `/api/clients/${clientId}/qr`;
    $('#qr-email').textContent = email;
    $('#qr-modal').classList.remove('hidden');
  };

  window.closeQRModal = function() {
    $('#qr-modal').classList.add('hidden');
  };

  // ─── Add Client ───────────────────────────────────────
  window.showAddClientModal = function() {
    $('#client-email').value = '';
    $('#client-limit').value = '0';
    $('#client-expiry').value = '';
    $('#add-client-modal').classList.remove('hidden');
  };

  window.closeAddClientModal = function() {
    $('#add-client-modal').classList.add('hidden');
  };

  window.createClient = async function() {
    const email = $('#client-email').value.trim();
    const limit_bytes = parseInt($('#client-limit').value) || 0;
    const expiry_date = $('#client-expiry').value || null;

    try {
      showLoading();
      await api(`/api/inbounds/${currentInboundId}/clients`, {
        method: 'POST',
        body: { email, limit_bytes, expiry_date }
      });
      hideLoading();
      closeAddClientModal();
      showToast('کلاینت با موفقیت اضافه شد', 'success');
      loadInboundDetail(currentInboundId);
    } catch (err) {
      hideLoading();
      showToast('خطا در اضافه کردن کلاینت: ' + err.message, 'error');
    }
  };

  // ─── Edit Client ──────────────────────────────────────
  window.showEditClientModal = function(id, email, limitBytes, expiryDate, enabled) {
    $('#edit-client-id').value = id;
    $('#edit-client-email').value = email || '';
    $('#edit-client-limit').value = limitBytes || 0;
    $('#edit-client-expiry').value = expiryDate ? expiryDate.split('T')[0] : '';
    $('#edit-client-enabled').checked = enabled === 1;
    $('#edit-client-modal').classList.remove('hidden');
  };

  window.closeEditClientModal = function() {
    $('#edit-client-modal').classList.add('hidden');
  };

  window.updateClient = async function() {
    const id = $('#edit-client-id').value;
    const email = $('#edit-client-email').value.trim();
    const limit_bytes = parseInt($('#edit-client-limit').value) || 0;
    const expiry_date = $('#edit-client-expiry').value || null;
    const enabled = $('#edit-client-enabled').checked;

    try {
      showLoading();
      await api(`/api/clients/${id}`, {
        method: 'PUT',
        body: { email, limit_bytes, expiry_date, enabled }
      });
      hideLoading();
      closeEditClientModal();
      showToast('کلاینت بروزرسانی شد', 'success');
      if (currentPage === 'inbound-detail') loadInboundDetail(currentInboundId);
      else if (currentPage === 'clients') loadAllClients();
    } catch (err) {
      hideLoading();
      showToast('خطا در بروزرسانی کلاینت: ' + err.message, 'error');
    }
  };

  // ─── Delete Client ────────────────────────────────────
  window.confirmDeleteClient = function(clientId) {
    showModal(
      'حذف کلاینت',
      'آیا مطمئن هستید که می‌خواهید این کلاینت را حذف کنید؟',
      () => deleteClient(clientId),
      'حذف'
    );
  };

  async function deleteClient(clientId) {
    try {
      showLoading();
      await api(`/api/clients/${clientId}`, { method: 'DELETE' });
      hideLoading();
      showToast('کلاینت حذف شد', 'success');
      if (currentPage === 'inbound-detail') loadInboundDetail(currentInboundId);
      else if (currentPage === 'clients') loadAllClients();
    } catch (err) {
      hideLoading();
      showToast('خطا در حذف کلاینت: ' + err.message, 'error');
    }
  }

  // ─── Settings ─────────────────────────────────────────
  window.loadSettings = async function() {
    try {
      const settings = await api('/api/settings');

      $('#setting-ws-path').value = settings.ws_path || '';
      const domain = window.location.hostname;
      const port = window.location.port || '443';
      $('#setting-ws-url').value = `wss://${domain}:${port}/${settings.ws_path || ''}`;
      $('#setting-panel-url').value = `${window.location.protocol}//${window.location.host}`;

      // Panel domain for subscription links
      const panelDomain = settings.panel_domain || window.location.hostname;
      $('#setting-panel-domain').value = settings.panel_domain || '';

      $('#setting-reality-dest').value = settings.reality_dest || 'www.microsoft.com:443';
      $('#setting-reality-server-name').value = settings.reality_server_name || 'www.microsoft.com';
      $('#setting-reality-public-key').value = settings.reality_public_key || '';
      $('#setting-reality-short-id').value = settings.reality_short_id || '';

      $('#setting-tcp-domain').value = settings.tcp_domain || '';
      $('#setting-tcp-port').value = settings.tcp_port || '443';
    } catch (err) {
      showToast('خطا در بارگذاری تنظیمات: ' + err.message, 'error');
    }
  };

  window.saveSettings = async function() {
    try {
      showLoading();
      await api('/api/settings', {
        method: 'PUT',
        body: {
          reality_dest: $('#setting-reality-dest').value.trim(),
          reality_server_name: $('#setting-reality-server-name').value.trim(),
          tcp_domain: $('#setting-tcp-domain').value.trim(),
          tcp_port: parseInt($('#setting-tcp-port').value) || 443
        }
      });
      hideLoading();
      showToast('تنظیمات ذخیره شد', 'success');
    } catch (err) {
      hideLoading();
      showToast('خطا در ذخیره تنظیمات: ' + err.message, 'error');
    }
  };

  window.savePanelDomain = async function() {
    try {
      showLoading();
      await api('/api/settings', {
        method: 'PUT',
        body: {
          panel_domain: $('#setting-panel-domain').value.trim()
        }
      });
      hideLoading();
      showToast('دامنه پنل ذخیره شد', 'success');
    } catch (err) {
      hideLoading();
      showToast('خطا در ذخیره دامنه: ' + err.message, 'error');
    }
  };

  window.generateRealityKeys = async function() {
    showModal(
      'تولید کلیدهای جدید',
      'آیا مطمئن هستید؟ کلیدهای قبلی باطل خواهند شد و کلاینت‌های موجود نیاز به بروزرسانی دارند.',
      async () => {
        try {
          showLoading();
          const result = await api('/api/settings/generate-reality', { method: 'POST' });
          hideLoading();
          showToast('کلیدهای جدید تولید شدند', 'success');
          loadSettings();
        } catch (err) {
          hideLoading();
          showToast('خطا در تولید کلید: ' + err.message, 'error');
        }
      },
      'تولید'
    );
  };

  window.confirmResetStats = function() {
    showModal(
      'بازنشانی آمار',
      'آیا مطمئن هستید که می‌خواهید تمام آمار ترافیک را بازنشانی کنید؟',
      async () => {
        try {
          showLoading();
          await api('/api/stats/reset');
          hideLoading();
          showToast('آمار بازنشانی شد', 'success');
        } catch (err) {
          hideLoading();
          showToast('خطا در بازنشانی آمار: ' + err.message, 'error');
        }
      },
      'بازنشانی'
    );
  };

  // ─── Clipboard ────────────────────────────────────────
  window.copyToClipboard = function(inputOrId) {
    let value;
    if (typeof inputOrId === 'string') {
      const input = $(`#${inputOrId}`);
      value = input ? input.value : '';
    } else if (inputOrId && inputOrId.getAttribute) {
      value = inputOrId.getAttribute('data-copy') || inputOrId.title || inputOrId.value || inputOrId.textContent;
    } else {
      return;
    }

    if (value) {
      navigator.clipboard.writeText(value).then(() => {
        showToast('کپی شد', 'success');
      }).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        showToast('کپی شد', 'success');
      });
    }
  };

  // ─── Init ─────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    // Check if already logged in
    try {
      const status = await api('/api/status');
      showApp();
    } catch (err) {
      showLogin();
    }

    // Auto-refresh dashboard every 30 seconds
    setInterval(() => {
      if (currentPage === 'dashboard') {
        loadDashboard();
      }
    }, 30000);
  });

})();
