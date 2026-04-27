/* ═══════════════════════════════════════════
   Minimaid – Frontend Application
   ═══════════════════════════════════════════ */

const COLORS = {
  pink: '#ff2d95',
  blue: '#00d4ff',
  green: '#39ff14',
  red: '#ff073a',
  yellow: '#ffbe0b',
};

const TYPE_ICONS = {
  'http': '🌐',
  'https': '🌐',
  'minecraft-java': '⛏️',
  'minecraft-bedrock': '⛏️',
  'fivem': '🚗',
};

const TYPE_CSS = {
  'http': 'type-http',
  'https': 'type-http',
  'minecraft-java': 'type-minecraft',
  'minecraft-bedrock': 'type-minecraft',
  'fivem': 'type-fivem',
};

let historyData = null;
let configData = null;
let manualIncidents = [];
let uptimeChart = null;
let responseChart = null;
let currentRange = '24h';
let currentServiceFilter = '__all__';

// ─── Bootstrap ──────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const [historyRes, configRes, incidentsRes] = await Promise.all([
      fetch('data/history.json'),
      fetch('minimaid.config.yml'),
      fetch('data/incidents.json').catch(() => null),
    ]);

    if (!historyRes.ok) throw new Error('history.json nicht gefunden');
    historyData = await historyRes.json();

    if (configRes.ok) {
      const yamlText = await configRes.text();
      configData = parseSimpleYaml(yamlText);
    }

    if (incidentsRes?.ok) {
      manualIncidents = await incidentsRes.json();
    }

    render();
  } catch (err) {
    console.error('Minimaid: Fehler beim Laden', err);
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
  }
}

// ─── Render Pipeline ────────────────────────────
function render() {
  document.getElementById('loading-state').classList.add('hidden');

  const services = configData?.services || [];
  const hasChecks = Object.values(historyData.services).some(s => s.checks?.length > 0);

  if (!hasChecks && services.length === 0) {
    document.getElementById('empty-state').classList.remove('hidden');
    return;
  }

  renderLastUpdated();
  renderOverallBanner(services);
  renderServiceCards(services);
  renderCharts(services);
  renderIncidents();
  bindChartControls();
}

function renderLastUpdated() {
  const el = document.getElementById('last-updated');
  if (historyData.lastUpdated) {
    const d = new Date(historyData.lastUpdated);
    el.textContent = `Letztes Update: ${formatDateTime(d)}`;
  }
}

// ─── Overall Banner ─────────────────────────────
function renderOverallBanner(services) {
  const banner = document.getElementById('overall-status');
  const statuses = services.map(s => getLatestStatus(s.id));

  const offlineCount = statuses.filter(s => s === 'offline').length;
  const degradedCount = statuses.filter(s => s === 'degraded').length;

  banner.style.display = 'block';

  if (offlineCount === 0 && degradedCount === 0) {
    banner.className = 'rounded-xl p-4 text-center font-semibold text-lg transition-all duration-500 border banner-all-online';
    banner.textContent = '✓ Alle Systeme sind betriebsbereit';
  } else if (offlineCount > 0) {
    banner.className = 'rounded-xl p-4 text-center font-semibold text-lg transition-all duration-500 border banner-major-outage';
    banner.textContent = `⚠ ${offlineCount} Service${offlineCount > 1 ? 's' : ''} offline`;
  } else {
    banner.className = 'rounded-xl p-4 text-center font-semibold text-lg transition-all duration-500 border banner-some-issues';
    banner.textContent = `⚡ ${degradedCount} Service${degradedCount > 1 ? 's' : ''} beeinträchtigt`;
  }
}

// ─── Service Cards ──────────────────────────────
function renderServiceCards(services) {
  const grid = document.getElementById('services-grid');
  grid.innerHTML = '';

  for (const service of services) {
    const svcHistory = historyData.services[service.id];
    const checks = svcHistory?.checks || [];
    const latest = checks[checks.length - 1];
    const status = latest?.status || 'unknown';

    const card = document.createElement('div');
    card.className = 'service-card';
    card.innerHTML = buildCardHTML(service, latest, status, checks);
    grid.appendChild(card);
  }
}

function buildCardHTML(service, latest, status, checks) {
  const icon = TYPE_ICONS[service.type] || '🔗';
  const typeCss = TYPE_CSS[service.type] || 'type-http';
  const uptime = calcUptimePercent(checks, 24 * 60);
  const uptimeColor = uptime >= 99 ? 'text-neon-green' : uptime >= 95 ? 'text-neon-yellow' : 'text-neon-red';

  let detailsHTML = '';
  if (latest?.details) {
    const d = latest.details;
    if (d.players !== undefined) {
      detailsHTML += `<span class="meta-pill">👥 ${d.players}/${d.maxPlayers || '?'}</span>`;
    }
    if (d.version) {
      detailsHTML += `<span class="meta-pill">v${d.version}</span>`;
    }
    if (d.statusCode) {
      detailsHTML += `<span class="meta-pill">HTTP ${d.statusCode}</span>`;
    }
  }

  const responseTime = latest?.responseTime;
  const rtDisplay = responseTime !== undefined ? `${responseTime}ms` : '—';

  const uptimeBarHTML = buildUptimeBar(checks, 48);

  return `
    <div class="flex items-start justify-between mb-4">
      <div class="flex items-center gap-3">
        <div class="type-icon ${typeCss}">${icon}</div>
        <div>
          <h3 class="font-semibold text-white text-sm">${escapeHtml(service.name)}</h3>
          <p class="text-xs text-gray-500 font-mono">${escapeHtml(service.type)}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div class="status-dot status-${status}"></div>
        <span class="status-badge badge-${status}">${statusLabel(status)}</span>
      </div>
    </div>

    <div class="mb-4">
      <div class="uptime-bar">${uptimeBarHTML}</div>
      <div class="flex justify-between mt-1.5 text-[0.65rem] text-gray-500">
        <span>48h her</span>
        <span>Jetzt</span>
      </div>
    </div>

    <div class="flex items-center justify-between">
      <div class="flex gap-2 flex-wrap">
        <span class="meta-pill">⏱ ${rtDisplay}</span>
        ${detailsHTML}
      </div>
      <span class="text-xs font-mono font-bold ${uptimeColor}">${uptime.toFixed(1)}%</span>
    </div>
  `;
}

function buildUptimeBar(checks, hours) {
  const now = Date.now();
  const segmentCount = Math.min(48, Math.max(12, hours));
  const totalMs = hours * 60 * 60 * 1000;
  const segmentMs = totalMs / segmentCount;
  const segments = [];

  for (let i = 0; i < segmentCount; i++) {
    const segStart = now - totalMs + i * segmentMs;
    const segEnd = segStart + segmentMs;

    const segChecks = checks.filter(c => {
      const t = new Date(c.timestamp).getTime();
      return t >= segStart && t < segEnd;
    });

    let cls = 'seg-nodata';
    let tooltip = formatDateShort(new Date(segStart));

    if (segChecks.length > 0) {
      const hasOffline = segChecks.some(c => c.status === 'offline');
      const hasDegraded = segChecks.some(c => c.status === 'degraded');

      if (hasOffline) {
        cls = 'seg-offline';
        tooltip += ' – Offline';
      } else if (hasDegraded) {
        cls = 'seg-degraded';
        tooltip += ' – Beeinträchtigt';
      } else {
        cls = 'seg-online';
        tooltip += ' – Online';
      }
    } else {
      tooltip += ' – Keine Daten';
    }

    segments.push(
      `<div class="uptime-bar-segment ${cls}"><div class="uptime-tooltip">${tooltip}</div></div>`
    );
  }

  return segments.join('');
}

// ─── Charts ─────────────────────────────────────
function renderCharts(services) {
  const section = document.getElementById('charts-section');
  section.style.display = 'block';

  const select = document.getElementById('chart-service-select');
  select.innerHTML = '<option value="__all__">Alle Services</option>';
  for (const svc of services) {
    const opt = document.createElement('option');
    opt.value = svc.id;
    opt.textContent = svc.name;
    select.appendChild(opt);
  }

  updateCharts();
}

function updateCharts() {
  const rangeMs = getRangeMs(currentRange);
  const cutoff = new Date(Date.now() - rangeMs);
  const services = configData?.services || [];

  destroyCharts();

  const uptimeCtx = document.getElementById('uptime-chart').getContext('2d');
  const responseCtx = document.getElementById('response-chart').getContext('2d');

  const filteredServices = currentServiceFilter === '__all__'
    ? services
    : services.filter(s => s.id === currentServiceFilter);

  const uptimeDatasets = [];
  const responseDatasets = [];
  const colorPalette = [COLORS.pink, COLORS.blue, COLORS.green, COLORS.yellow, '#a855f7', '#f97316'];

  filteredServices.forEach((svc, idx) => {
    const checks = (historyData.services[svc.id]?.checks || [])
      .filter(c => new Date(c.timestamp) >= cutoff);

    if (checks.length === 0) return;

    const color = colorPalette[idx % colorPalette.length];
    const buckets = bucketize(checks, currentRange);

    uptimeDatasets.push({
      label: svc.name,
      data: buckets.map(b => ({ x: b.time, y: b.uptimePercent })),
      borderColor: color,
      backgroundColor: hexToRgba(color, 0.1),
      borderWidth: 2,
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      pointHitRadius: 8,
    });

    responseDatasets.push({
      label: svc.name,
      data: buckets.map(b => ({ x: b.time, y: b.avgResponseTime })),
      borderColor: color,
      backgroundColor: hexToRgba(color, 0.08),
      borderWidth: 2,
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      pointHitRadius: 8,
    });
  });

  const timeUnit = getTimeUnit(currentRange);

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: filteredServices.length > 1,
        labels: { color: '#888', font: { size: 11 }, boxWidth: 12 },
      },
      tooltip: {
        backgroundColor: '#111128',
        borderColor: 'rgba(255, 45, 149, 0.3)',
        borderWidth: 1,
        titleColor: '#fff',
        bodyColor: '#ccc',
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        type: 'time',
        time: { unit: timeUnit },
        grid: { color: 'rgba(26, 26, 62, 0.5)' },
        ticks: { color: '#555', font: { size: 10 } },
      },
      y: {
        grid: { color: 'rgba(26, 26, 62, 0.5)' },
        ticks: { color: '#555', font: { size: 10 } },
      },
    },
  };

  uptimeChart = new Chart(uptimeCtx, {
    type: 'line',
    data: { datasets: uptimeDatasets },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: { ...commonOptions.scales.y, min: 0, max: 100, ticks: { ...commonOptions.scales.y.ticks, callback: v => v + '%' } },
      },
    },
  });

  responseChart = new Chart(responseCtx, {
    type: 'line',
    data: { datasets: responseDatasets },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: { ...commonOptions.scales.y, beginAtZero: true, ticks: { ...commonOptions.scales.y.ticks, callback: v => v + 'ms' } },
      },
    },
  });
}

function bucketize(checks, range) {
  const bucketCount = { '24h': 24, '7d': 28, '30d': 30, '90d': 45 }[range] || 24;
  const rangeMs = getRangeMs(range);
  const now = Date.now();
  const bucketMs = rangeMs / bucketCount;
  const buckets = [];

  for (let i = 0; i < bucketCount; i++) {
    const start = now - rangeMs + i * bucketMs;
    const end = start + bucketMs;

    const inBucket = checks.filter(c => {
      const t = new Date(c.timestamp).getTime();
      return t >= start && t < end;
    });

    const total = inBucket.length;
    const onlineCount = inBucket.filter(c => c.status === 'online').length;
    const avgRt = total > 0
      ? inBucket.reduce((sum, c) => sum + (c.responseTime || 0), 0) / total
      : 0;

    buckets.push({
      time: new Date(start + bucketMs / 2),
      uptimePercent: total > 0 ? (onlineCount / total) * 100 : null,
      avgResponseTime: total > 0 ? Math.round(avgRt) : null,
    });
  }

  return buckets.filter(b => b.uptimePercent !== null);
}

function destroyCharts() {
  if (uptimeChart) { uptimeChart.destroy(); uptimeChart = null; }
  if (responseChart) { responseChart.destroy(); responseChart = null; }
}

function bindChartControls() {
  document.querySelectorAll('.chart-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chart-range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.dataset.range;
      updateCharts();
    });
  });

  document.getElementById('chart-service-select').addEventListener('change', (e) => {
    currentServiceFilter = e.target.value;
    updateCharts();
  });
}

// ─── Incidents ──────────────────────────────────
function renderIncidents() {
  const section = document.getElementById('incidents-section');
  const list = document.getElementById('incidents-list');
  const noIncidents = document.getElementById('no-incidents');

  const autoIncidents = (historyData.incidents || []).map(inc => ({
    ...inc,
    _source: 'auto',
    _sortDate: inc.timestamp,
  }));

  const manual = (manualIncidents || []).map(inc => ({
    ...inc,
    _source: 'manual',
    _sortDate: inc.updates?.length
      ? inc.updates[inc.updates.length - 1].timestamp
      : inc.createdAt,
  }));

  const all = [...autoIncidents, ...manual].sort(
    (a, b) => new Date(b._sortDate).getTime() - new Date(a._sortDate).getTime()
  );

  section.style.display = 'block';

  if (all.length === 0) {
    list.classList.add('hidden');
    noIncidents.classList.remove('hidden');
    return;
  }

  noIncidents.classList.add('hidden');
  list.classList.remove('hidden');

  list.innerHTML = all.slice(0, 25).map(inc => {
    if (inc._source === 'auto') return renderAutoIncident(inc);
    return renderManualIncident(inc);
  }).join('');
}

function renderAutoIncident(inc) {
  const statusCls = inc.newStatus === 'offline' ? 'incident-offline'
    : inc.newStatus === 'online' ? 'incident-resolved'
    : 'incident-degraded';

  const icon = inc.newStatus === 'offline' ? '🔴'
    : inc.newStatus === 'online' ? '🟢' : '🟡';

  return `
    <div class="incident-item ${statusCls}">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="font-medium text-white text-sm">
            ${icon} ${escapeHtml(inc.title)}
          </p>
          <p class="text-xs text-gray-500 mt-1">
            ${escapeHtml(inc.serviceName || '')} &middot; ${formatDateTime(new Date(inc.timestamp))}
          </p>
        </div>
        <span class="status-badge badge-${inc.newStatus}">${statusLabel(inc.newStatus)}</span>
      </div>
    </div>
  `;
}

function renderManualIncident(inc) {
  const severityMap = {
    critical: 'incident-offline',
    major: 'incident-offline',
    minor: 'incident-degraded',
    maintenance: 'incident-degraded',
  };
  const statusMap = {
    investigating: 'incident-offline',
    identified: 'incident-offline',
    monitoring: 'incident-degraded',
    resolved: 'incident-resolved',
    maintenance: 'incident-degraded',
  };
  const iconMap = {
    investigating: '🔍',
    identified: '🔎',
    monitoring: '👀',
    resolved: '✅',
    maintenance: '🔧',
  };
  const badgeStatusMap = {
    investigating: 'offline',
    identified: 'offline',
    monitoring: 'degraded',
    resolved: 'online',
    maintenance: 'degraded',
  };

  const cls = statusMap[inc.status] || severityMap[inc.severity] || 'incident-degraded';
  const icon = iconMap[inc.status] || '⚡';
  const badgeStatus = badgeStatusMap[inc.status] || 'degraded';

  const updatesHTML = (inc.updates || [])
    .slice()
    .reverse()
    .map(u => {
      const uIcon = iconMap[u.status] || '📝';
      return `
        <div class="flex gap-3 items-start">
          <div class="flex flex-col items-center">
            <span class="text-xs">${uIcon}</span>
            <div class="w-px h-full bg-neon-border/50 mt-1"></div>
          </div>
          <div class="pb-3">
            <p class="text-xs font-semibold text-gray-300 uppercase tracking-wide">${escapeHtml(u.status)}</p>
            <p class="text-sm text-gray-400 mt-0.5">${escapeHtml(u.message || '')}</p>
            <p class="text-[0.65rem] text-gray-600 mt-1 font-mono">${formatDateTime(new Date(u.timestamp))}</p>
          </div>
        </div>
      `;
    }).join('');

  const servicesHTML = inc.services?.length
    ? `<span class="text-xs text-gray-600 ml-2">${inc.services.map(s => `<span class="meta-pill">${escapeHtml(s)}</span>`).join(' ')}</span>`
    : '';

  return `
    <div class="incident-item ${cls}">
      <div class="flex items-start justify-between gap-3 mb-3">
        <div>
          <p class="font-medium text-white text-sm">
            ${icon} ${escapeHtml(inc.title)}
          </p>
          <p class="text-xs text-gray-500 mt-1">
            ${formatDateTime(new Date(inc.createdAt))}${servicesHTML}
          </p>
        </div>
        <span class="status-badge badge-${badgeStatus}">${escapeHtml(inc.status)}</span>
      </div>
      ${updatesHTML ? `<div class="ml-1 mt-2 border-l border-neon-border/30 pl-2">${updatesHTML}</div>` : ''}
    </div>
  `;
}

// ─── Status Labels ──────────────────────────────

// ─── Helpers ────────────────────────────────────
function getLatestStatus(serviceId) {
  const checks = historyData.services[serviceId]?.checks || [];
  return checks.length > 0 ? checks[checks.length - 1].status : 'unknown';
}

function calcUptimePercent(checks, minutes) {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  const recent = checks.filter(c => new Date(c.timestamp) >= cutoff);
  if (recent.length === 0) return 100;
  const online = recent.filter(c => c.status === 'online').length;
  return (online / recent.length) * 100;
}

function statusLabel(status) {
  const labels = {
    online: 'Online', offline: 'Offline', degraded: 'Degraded', unknown: 'Unbekannt',
    investigating: 'Untersuchung', identified: 'Identifiziert',
    monitoring: 'Beobachtung', resolved: 'Gelöst', maintenance: 'Wartung',
  };
  return labels[status] || status;
}

function getRangeMs(range) {
  const ms = { '24h': 86400000, '7d': 604800000, '30d': 2592000000, '90d': 7776000000 };
  return ms[range] || ms['24h'];
}

function getTimeUnit(range) {
  const units = { '24h': 'hour', '7d': 'day', '30d': 'day', '90d': 'week' };
  return units[range] || 'hour';
}

function formatDateTime(date) {
  return date.toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDateShort(date) {
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
    + ' ' + date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Minimal YAML parser for config (supports flat + nested structures)
function parseSimpleYaml(text) {
  const lines = text.split('\n');
  const result = { services: [] };
  let currentSection = null;
  let currentItem = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (trimmed.startsWith('- ') && currentSection === 'services') {
      if (currentItem) result.services.push(currentItem);
      currentItem = {};
      const kv = trimmed.slice(2).trim();
      if (kv.includes(':')) {
        const [k, ...v] = kv.split(':');
        currentItem[k.trim()] = parseYamlValue(v.join(':').trim());
      }
      continue;
    }

    if (indent >= 4 && currentItem) {
      if (trimmed.includes(':')) {
        const [k, ...v] = trimmed.split(':');
        currentItem[k.trim()] = parseYamlValue(v.join(':').trim());
      }
      continue;
    }

    if (trimmed.endsWith(':') && indent === 0) {
      if (currentItem && currentSection === 'services') {
        result.services.push(currentItem);
        currentItem = null;
      }
      currentSection = trimmed.slice(0, -1).trim();
      continue;
    }

    if (indent === 2 && trimmed.endsWith(':')) {
      currentSection = trimmed.slice(0, -1).trim();
      continue;
    }
  }

  if (currentItem && currentSection === 'services') {
    result.services.push(currentItem);
  }

  return result;
}

function parseYamlValue(val) {
  if (!val) return '';
  if (val.startsWith('"') && val.endsWith('"')) return val.slice(1, -1);
  if (val.startsWith("'") && val.endsWith("'")) return val.slice(1, -1);
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  if (/^\d+\.\d+$/.test(val)) return parseFloat(val);
  return val;
}
