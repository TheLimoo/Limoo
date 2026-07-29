// ─── app.js — Limoo Frontend (WS Only) ────────────────
// Redesigned with modern animations and interactions
(function() {
  'use strict';

  // ─── State ────────────────────────────────────────────
  let currentPage = 'dashboard';
  let currentInboundId = null;

  // ─── Utilities ────────────────────────────────────────
  function $(selector) { return document.querySelector(selector); }
  function $$(selector) { return document.querySelectorAll(selector); }

  async function api(url, options = {}) {
    const defaults = {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    };
    const cfg = { ...defaults, ...options };
    if (options.body && typeof options.body === 'object') {
      cfg.body = JSON.stringify(options.body);
    }
    try {
      const response = await fetch(url, cfg);
      if (response.status === 401) { showLogin(); throw new Error('Unauthorized'); }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Request failed');
      return data;
    } catch (err) {
      if (err.message !== 'Unauthorized') throw err;
      throw err;
    }
  }

  // ─── Toast ────────────────────────────────────────────
  function showToast(message, type = 'info') {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
    }, 3200);
  }

  // ─── Loading ──────────────────────────────────────────
  function showLoading() { $('#loading-overlay').classList.remove('hidden'); }
  function hideLoading() { $('#loading-overlay').classList.add('hidden'); }

  // ─── Loading Skeleton ─────────────────────────────────
  function showSkeletons(containerId, count = 3) {
    const container = $(containerId);
    if (!container) return;
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `
        <div class="list-item" style="animation:none;opacity:1;">
          <div class="list-item-info" style="gap:12px;">
            <div class="skeleton skeleton-circle"></div>
            <div style="flex:1;">
              <div class="skeleton skeleton-text medium"></div>
              <div class="skeleton skeleton-text short" style="height:10px;"></div>
            </div>
          </div>
        </div>`;
    }
    container.innerHTML = html;
  }

  function showStatSkeletons() {
    const grid = $('#stats-grid');
    if (!grid) return;
    grid.innerHTML = `
      <div class="skeleton skeleton-stat" style="animation:none;opacity:1;"></div>
      <div class="skeleton skeleton-stat" style="animation:none;opacity:1;"></div>
      <div class="skeleton skeleton-stat" style="animation:none;opacity:1;"></div>
      <div class="skeleton skeleton-stat" style="animation:none;opacity:1;"></div>`;
  }

  // ─── Modal ────────────────────────────────────────────
  let modalConfirmCallback = null;

  function showModal(title, message, onConfirm, confirmText = 'تأیید') {
    $('#modal-title').textContent = title;
    $('#modal-message').textContent = message;
    const confirmBtn = $('#modal-confirm');
    confirmBtn.textContent = confirmText;
    confirmBtn.className = 'btn btn-danger btn-ripple';
    modalConfirmCallback = onConfirm;
    $('#modal-overlay').classList.remove('hidden');
  }

  window.closeModal = function() {
    $('#modal-overlay').classList.add('hidden');
    modalConfirmCallback = null;
  };

  // ─── Ripple Effect ────────────────────────────────────
  function initRipple() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-ripple');
      if (!btn) return;
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2;
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
  }

  // ─── Count-up Animation ──────────────────────────────
  function countUp(element, target, duration = 800) {
    if (!element) return;
    const text = element.textContent;
    // If target is not a pure number (e.g. "3/5" or "1.2 GB"), just set it
    if (typeof target === 'string' && !/^\d+(\.\d+)?$/.test(target)) {
      element.textContent = target;
      return;
    }
    const numTarget = parseFloat(target);
    if (isNaN(numTarget)) {
      element.textContent = target;
      return;
    }
    const startTime = performance.now();
    const startVal = 0;
    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startVal + (numTarget - startVal) * eased);
      element.textContent = current;
      if (progress < 1) requestAnimationFrame(update);
    }
    element.textContent = '0';
    requestAnimationFrame(update);
  }

  // ─── Page Transition ──────────────────────────────────
  function showView(view) {
    $$('.view').forEach(v => {
      v.classList.remove('active');
      v.classList.add('hidden');
    });
    if (view) {
      view.classList.remove('hidden');
      view.classList.add('active');
      // Re-trigger animation
      view.style.animation = 'none';
      view.offsetHeight; // force reflow
      view.style.animation = '';
    }
  }

  // ─── Navigation ───────────────────────────────────────
  window.navigateTo = function(page, data) {
    currentPage = page;

    // Update nav
    $$('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = $(`.nav-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');

    // Show target
    if (page === 'inbound-detail' && data) {
      currentInboundId = data;
      showView($('#view-inbound-detail'));
      loadInboundDetail(data);
    } else {
      showView($(`#view-${page}`));
    }

    // Load data
    switch (page) {
      case 'dashboard': loadDashboard(); break;
      case 'inbounds': loadInbounds(); break;
      case 'clients': loadAllClients(); break;
      case 'settings': loadSettings(); break;
    }

    // Close sidebar on mobile
    $('#sidebar').classList.remove('open');
    $('#sidebar-overlay').classList.remove('active');
  };

  window.toggleSidebar = function() {
    const sidebar = $('#sidebar');
    const overlay = $('#sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
  };

  // ─── Password Toggle ─────────────────────────────────
  window.togglePassword = function() {
    const input = $('#password');
    const btn = $('.password-toggle');
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '🔒';
    } else {
      input.type = 'password';
      btn.textContent = '👁';
    }
  };

  // ─── Copy Feedback ────────────────────────────────────
  window.flashCopy = function(btn) {
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1200);
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
    try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
    showLogin();
  };

  document.addEventListener('DOMContentLoaded', () => {
    initRipple();

    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = $('#password').value;
      try {
        showLoading();
        await api('/api/login', { method: 'POST', body: { password } });
        hideLoading();
        showApp();
      } catch (err) {
        hideLoading();
        const errEl = $('#login-error');
        errEl.textContent = 'رمز عبور اشتباه است';
        errEl.classList.remove('hidden');
        // Re-trigger shake animation
        errEl.style.animation = 'none';
        errEl.offsetHeight;
        errEl.style.animation = '';
      }
    });
  });

  // ─── Dashboard ────────────────────────────────────────
  window.loadDashboard = async function() {
    try {
      const data = await api('/api/dashboard');

      // Count-up animations for stats
      const uploadEl = $('#stat-upload');
      const downloadEl = $('#stat-download');
      const inboundsEl = $('#stat-inbounds');
      const clientsEl = $('#stat-clients');

      // Animate stat values
      uploadEl.textContent = data.stats.totalUpFormatted;
      downloadEl.textContent = data.stats.totalDownFormatted;
      inboundsEl.textContent = `${data.stats.enabledInbounds}/${data.stats.totalInbounds}`;
      clientsEl.textContent = data.stats.totalClients;

      try {
        const status = await api('/api/status');
        updateStatusBadge(status);
      } catch (e) {}

      renderInboundsList('inbounds-list-dashboard', data.inbounds, true);
    } catch (err) {
      showToast('خطا در بارگذاری داشبورد: ' + err.message, 'error');
    }
  };

  function updateStatusBadge(status) {
    const badge = $('#xray-status');
    if (status.running) {
      badge.className = 'status-badge status-running';
      badge.innerHTML = '<span class="status-dot"></span> فعال';
    } else {
      badge.className = 'status-badge status-stopped';
      badge.innerHTML = '<span class="status-dot"></span> غیرفعال';
    }
  }

  // ─── Inbounds ─────────────────────────────────────────
  window.loadInbounds = async function() {
    showSkeletons('#inbounds-list', 4);
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
          <div class="empty-state-icon">⚡</div>
          <div class="empty-state-text">هیچ اینبندی وجود ندارد</div>
        </div>`;
      return;
    }

    container.innerHTML = inbounds.map((inbound, index) => `
      <div class="list-item list-item-clickable" onclick="navigateTo('inbound-detail', ${inbound.id})" style="animation-delay:${index * 0.06}s;">
        <div class="list-item-info">
          <span class="list-item-badge badge-${inbound.protocol}">${inbound.protocol.toUpperCase()}</span>
          <span class="list-item-badge badge-ws">WS</span>
          <div>
            <div class="list-item-name">${inbound.remark || inbound.tag}</div>
            <div class="list-item-meta">${inbound.client_count || 0} کلاینت • ${inbound.tag}</div>
          </div>
        </div>
        <div class="list-item-actions">
          <span class="list-item-badge ${inbound.enabled ? 'badge-enabled' : 'badge-disabled'}">
            ${inbound.enabled ? 'فعال' : 'غیرفعال'}
          </span>
          <button class="btn btn-sm btn-danger inbound-action-btn" onclick="event.stopPropagation(); currentInboundId=${inbound.id}; confirmDeleteInbound();" title="حذف اینبند">✕</button>
        </div>
      </div>
    `).join('');
  }

  // ─── Add Inbound ──────────────────────────────────────
  window.showAddInboundModal = function() {
    $('#inbound-protocol').value = 'vless';
    $('#inbound-remark').value = '';
    $('#add-inbound-modal').classList.remove('hidden');
  };

  window.closeAddInboundModal = function() {
    $('#add-inbound-modal').classList.add('hidden');
  };

  window.createInbound = async function() {
    const protocol = $('#inbound-protocol').value;
    const remark = $('#inbound-remark').value.trim();

    try {
      showLoading();
      await api('/api/inbounds', { method: 'POST', body: { protocol, remark } });
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
    showSkeletons('#clients-list', 3);
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
      const domain = settings.panel_domain || window.location.hostname;
      const wsPath = settings.ws_path || '...';

      const infoBox = $('#inbound-info-box');
      infoBox.innerHTML = `
        <div class="inbound-info-card">
          <div class="inbound-info-title">⚡ اطلاعات اتصال WebSocket</div>
          <div class="inbound-info-row">
            <span class="inbound-info-label">دامنه:</span>
            <span class="inbound-info-value">${domain}:443</span>
          </div>
          <div class="inbound-info-row">
            <span class="inbound-info-label">مسیر:</span>
            <span class="inbound-info-value">/${wsPath}</span>
          </div>
          <div class="inbound-info-row">
            <span class="inbound-info-label">پروتکل:</span>
            <span class="inbound-info-value">${inbound.protocol.toUpperCase()} + WS</span>
          </div>
        </div>`;

      const clients = await api(`/api/inbounds/${inboundId}/clients`);
      renderClientsList(clients);
    } catch (err) {
      showToast('خطا در بارگذاری جزئیات: ' + err.message, 'error');
    }
  };

  function renderClientsList(clients) {
    const container = $('#clients-list');

    if (!clients || clients.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⬡</div>
          <div class="empty-state-text">هیچ کلاینتی وجود ندارد</div>
          <div class="empty-state-text" style="font-size:12px;color:#555577;">روی "+ اضافه کردن کلاینت" بزنید</div>
        </div>`;
      return;
    }

    container.innerHTML = clients.map((client, index) => {
      const isExpired = client.isExpired;
      const isOverLimit = client.isOverLimit;
      const isDisabled = client.enabled !== 1;

      let statusBadges = '';
      if (isDisabled) statusBadges += '<span class="list-item-badge badge-disabled">غیرفعال</span>';
      if (isExpired) statusBadges += '<span class="list-item-badge badge-expired">منقضی</span>';
      if (isOverLimit) statusBadges += '<span class="list-item-badge badge-expired">overflow</span>';
      if (!isDisabled && !isExpired && !isOverLimit) statusBadges += '<span class="list-item-badge badge-enabled">فعال</span>';

      const subToken = client.sub_token || '';
      const subTokenShort = subToken.length > 12 ? subToken.substring(0, 12) + '...' : subToken;
      const safeEmail = (client.email || '').replace(/'/g, "\\'");
      const initial = (client.email || 'U').charAt(0).toUpperCase();

      // Traffic progress
      let progressHtml = '';
      if (client.limit_bytes > 0) {
        const totalTraffic = (client.up || 0) + (client.down || 0);
        const pct = Math.min((totalTraffic / client.limit_bytes) * 100, 100);
        progressHtml = `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>`;
      }

      return `
        <div class="list-item" style="flex-direction:column;align-items:stretch;gap:8px;animation-delay:${index * 0.06}s;">
          <div class="list-item-info" style="gap:12px;">
            <div class="client-avatar">${initial}</div>
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
              ${progressHtml}
              ${subToken ? `
              <div style="margin-top:6px;font-size:11px;display:flex;align-items:center;gap:8px;">
                <span style="color:#555577;">🔑</span>
                <span style="color:#8888aa;font-family:monospace;direction:ltr;" title="${subToken}">${subTokenShort}</span>
                <button class="btn btn-secondary btn-sm" style="padding:2px 6px;font-size:10px;" onclick="event.stopPropagation();copyToClipboard(this.parentElement.querySelector('span[title]'))" data-copy="${subToken}">⧉</button>
              </div>` : ''}
              <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">${statusBadges}</div>
            </div>
          </div>
          <div class="client-actions-row">
            <button class="btn btn-primary btn-sm btn-ripple" onclick="showClientLink(${client.id})" style="flex:1;min-width:90px;">🔗 لینک اشتراک</button>
            <button class="btn btn-secondary btn-sm btn-ripple" onclick="showClientQR(${client.id}, '${safeEmail}')">▣ QR</button>
            ${subToken ? `<button class="btn btn-secondary btn-sm btn-ripple" onclick="window.open('/subpage/${subToken}', '_blank')" title="صفحه وضعیت کلاینت">⬡ وضعیت</button>` : ''}
            <button class="btn btn-secondary btn-sm btn-ripple" onclick="showEditClientModal(${client.id}, '${safeEmail}', ${client.limit_bytes || 0}, '${client.expiry_date || ''}', ${client.enabled})">✎</button>
            <button class="btn btn-danger btn-sm btn-ripple" onclick="confirmDeleteClient(${client.id})">✕</button>
          </div>
        </div>`;
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
    showSkeletons('#all-clients-list', 5);
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
          <div class="empty-state-icon">⬡</div>
          <div class="empty-state-text">هیچ کلاینتی وجود ندارد</div>
          <div class="empty-state-text" style="font-size:12px;color:#555577;">از بخش اینباندها کلاینت اضافه کنید</div>
        </div>`;
      return;
    }

    // Group by inbound
    const grouped = {};
    clients.forEach(client => {
      const key = client.inbound_remark || client.inbound_tag || 'نامشخص';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(client);
    });

    let html = '';
    let itemIndex = 0;
    for (const [groupName, groupClients] of Object.entries(grouped)) {
      html += `
        <div class="section-header">
          <span style="font-size:14px;">⚡</span>
          <span class="section-header-title">${groupName}</span>
          <span class="section-header-line"></span>
          <span style="font-size:11px;color:#555577;">${groupClients.length} کلاینت</span>
        </div>`;

      groupClients.forEach(client => {
        const isExpired = client.isExpired;
        const isOverLimit = client.isOverLimit;
        const isDisabled = client.enabled !== 1;

        let statusBadges = '';
        if (isDisabled) statusBadges += '<span class="list-item-badge badge-disabled">غیرفعال</span>';
        if (isExpired) statusBadges += '<span class="list-item-badge badge-expired">منقضی</span>';
        if (isOverLimit) statusBadges += '<span class="list-item-badge badge-expired">overflow</span>';
        if (!isDisabled && !isExpired && !isOverLimit) statusBadges += '<span class="list-item-badge badge-enabled">فعال</span>';

        const subToken = client.sub_token || '';
        const subTokenShort = subToken.length > 12 ? subToken.substring(0, 12) + '...' : subToken;
        const safeEmail = (client.email || '').replace(/'/g, "\\'");
        const initial = (client.email || 'U').charAt(0).toUpperCase();

        let progressHtml = '';
        if (client.limit_bytes > 0) {
          const totalTraffic = (client.up || 0) + (client.down || 0);
          const pct = Math.min((totalTraffic / client.limit_bytes) * 100, 100);
          progressHtml = `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>`;
        }

        html += `
          <div class="list-item" style="flex-direction:column;align-items:stretch;gap:8px;animation-delay:${itemIndex * 0.06}s;">
            <div class="list-item-info" style="gap:12px;">
              <div class="client-avatar">${initial}</div>
              <div style="flex:1;min-width:0">
                <div class="list-item-name">${client.email || 'user-' + client.id}</div>
                <div class="list-item-meta">
                  <span class="list-item-badge badge-${client.protocol}" style="margin-left:4px;">${(client.protocol || '').toUpperCase()}</span>
                  <span class="list-item-badge badge-ws">WS</span>
                </div>
                <div class="list-item-meta">
                  <span class="traffic-info">
                    <span class="traffic-up">↑${client.upFormatted || '0 B'}</span> •
                    <span class="traffic-down">↓${client.downFormatted || '0 B'}</span>
                  </span>
                  ${client.expiry_date ? ` • انقضا: ${new Date(client.expiry_date).toLocaleDateString('fa-IR')}` : ''}
                  ${client.limit_bytes > 0 ? ` • لیمیت: ${formatBytesJS(client.limit_bytes)}` : ''}
                </div>
                ${progressHtml}
                ${subToken ? `
                <div style="margin-top:6px;font-size:11px;display:flex;align-items:center;gap:8px;">
                  <span style="color:#555577;">🔑</span>
                  <span style="color:#8888aa;font-family:monospace;direction:ltr;" title="${subToken}">${subTokenShort}</span>
                  <button class="btn btn-secondary btn-sm" style="padding:2px 6px;font-size:10px;" onclick="event.stopPropagation();copyToClipboard(this.parentElement.querySelector('span[title]'))" data-copy="${subToken}">⧉</button>
                </div>` : ''}
                <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">${statusBadges}</div>
              </div>
            </div>
            <div class="client-actions-row">
              <button class="btn btn-primary btn-sm btn-ripple" onclick="showClientLink(${client.id})" style="flex:1;min-width:90px;">🔗 لینک اشتراک</button>
              <button class="btn btn-secondary btn-sm btn-ripple" onclick="showClientQR(${client.id}, '${safeEmail}')">▣ QR</button>
              ${subToken ? `<button class="btn btn-secondary btn-sm btn-ripple" onclick="window.open('/subpage/${subToken}', '_blank')" title="صفحه وضعیت کلاینت">⬡ وضعیت</button>` : ''}
            </div>
          </div>`;
        itemIndex++;
      });
    }

    container.innerHTML = html;
  }

  // ─── Client Link ──────────────────────────────────────
  window.showClientLink = async function(clientId) {
    try {
      const data = await api(`/api/clients/${clientId}/link`);
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      const safeLink = data.link.replace(/'/g, "\\'");
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-header">
            <h3>🔗 لینک اشتراک</h3>
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
          </div>
          <div class="modal-body">
            <div class="link-display">
              <div class="link-display-label">لینک اشتراک کلاینت:</div>
              <div class="link-display-value" onclick="copyLink('${safeLink}')">
                ${data.link}
              </div>
            </div>
            <p style="text-align:center;margin-top:10px;font-size:12px;color:#555577;">روی لینک بزنید تا کپی شود</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-primary btn-ripple" onclick="copyLink('${safeLink}')">⧉ کپی لینک</button>
            <button class="btn btn-secondary btn-ripple" onclick="this.closest('.modal-overlay').remove()">بستن</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
    } catch (err) {
      showToast('خطا در دریافت لینک: ' + err.message, 'error');
    }
  };

  window.copyLink = function(link) {
    navigator.clipboard.writeText(link).then(() => {
      showToast('لینک کپی شد', 'success');
    }).catch(() => {
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
        method: 'POST', body: { email, limit_bytes, expiry_date }
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
        method: 'PUT', body: { email, limit_bytes, expiry_date, enabled }
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

      const domain = window.location.hostname;
      const port = window.location.port || '443';
      $('#setting-ws-path').value = settings.ws_path || '';
      $('#setting-ws-url').value = `wss://${domain}:${port}/${settings.ws_path || ''}`;
      $('#setting-panel-url').value = `${window.location.protocol}//${window.location.host}`;
      $('#setting-panel-domain').value = settings.panel_domain || '';
    } catch (err) {
      showToast('خطا در بارگذاری تنظیمات: ' + err.message, 'error');
    }
  };

  window.savePanelDomain = async function() {
    try {
      showLoading();
      await api('/api/settings', {
        method: 'PUT',
        body: { panel_domain: $('#setting-panel-domain').value.trim() }
      });
      hideLoading();
      showToast('دامنه پنل ذخیره شد', 'success');
    } catch (err) {
      hideLoading();
      showToast('خطا در ذخیره دامنه: ' + err.message, 'error');
    }
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
    try {
      await api('/api/status');
      showApp();
    } catch (err) {
      showLogin();
    }

    setInterval(() => {
      if (currentPage === 'dashboard') loadDashboard();
    }, 30000);
  });

})();
