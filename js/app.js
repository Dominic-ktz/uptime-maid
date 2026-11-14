/* ═══════════════════════════════════════════
   Minimaid – Frontend
   Lädt data/config.json, data/history.json und data/incidents.json,
   rendert alles clientseitig und aktualisiert sich jede Minute selbst.
   ═══════════════════════════════════════════ */

const REFRESH_MS = 60_000;
const STALE_AFTER_MS = 6 * 3_600_000;
const BAR_DAYS = 30;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const RANGES = {
  '24h': { ms: DAY, buckets: 24 },
  '7d': { ms: 7 * DAY, buckets: 28 },
  '30d': { ms: 30 * DAY, buckets: 30 },
  '90d': { ms: 90 * DAY, buckets: 45 },
};

const TYPE_META = {
  http: { icon: '🌐', label: 'Website', css: 'type-http' },
  https: { icon: '🌐', label: 'Website', css: 'type-http' },
  tcp: { icon: '🔌', label: 'TCP', css: 'type-tcp' },
  'minecraft-java': { icon: '⛏️', label: 'Minecraft Java', css: 'type-minecraft' },
  'minecraft-bedrock': { icon: '⛏️', label: 'Minecraft Bedrock', css: 'type-minecraft' },
  fivem: { icon: '🚗', label: 'FiveM', css: 'type-fivem' },
};

const STATUS_LABEL = {
  online: 'Online', offline: 'Offline', degraded: 'Beeinträchtigt', unknown: 'Unbekannt',
  investigating: 'Untersuchung', identified: 'Identifiziert', monitoring: 'Beobachtung',
  resolved: 'Gelöst', maintenance: 'Wartung',
};

/** Manuelle Vorfall-Status → Farbton der Status-Badges. */
const INCIDENT_TONE = {
  investigating: 'offline', identified: 'offline', monitoring: 'degraded',
  resolved: 'online', maintenance: 'info', offline: 'offline', degraded: 'degraded',
};
const INCIDENT_ICON = { investigating: '🔍', identified: '🔎', monitoring: '👀', resolved: '✅', maintenance: '🔧' };

const state = {
  config: null,
  history: null,
  manualIncidents: [],
  checksById: new Map(),
  range: '24h',
  filter: '__all__',
  charts: { uptime: null, response: null },
};

const $ = (sel) => document.querySelector(sel);

const fmtDateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const fmtDay = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const fmtTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtShortDate = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
const fmtRelative = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });

// ─── Kleine DOM-Hilfe: erzeugt Elemente ohne innerHTML (kein XSS-Risiko) ───
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

// ─── Daten laden ───────────────────────────────
async function fetchJson(path, { optional = false } = {}) {
  try {
    const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (optional) return null;
    throw err;
  }
}

async function loadData() {
  const [history, config, incidents] = await Promise.all([
    fetchJson('data/history.json'),
    fetchJson('data/config.json', { optional: true }),
    fetchJson('data/incidents.json', { optional: true }),
  ]);

  state.history = { services: {}, incidents: [], ...history };
  state.manualIncidents = Array.isArray(incidents) ? incidents : [];
  // Fallback, falls config.json (noch) fehlt: Services aus der History ableiten.
  state.config = config ?? {
    site: {},
    theme: {},
    services: Object.keys(state.history.services).map((id) => ({ id, name: id, type: 'http' })),
  };

  state.checksById = new Map(
    Object.entries(state.history.services).map(([id, svc]) => [
      id,
      (svc.checks ?? [])
        .map((c) => ({ ...c, t: Date.parse(c.timestamp) }))
        .sort((a, b) => a.t - b.t),
    ])
  );
}

const services = () => state.config.services ?? [];
const checksOf = (id) => state.checksById.get(id) ?? [];
const latestOf = (id) => checksOf(id).at(-1) ?? null;

// ─── Berechnungen ──────────────────────────────
function uptimeSince(checks, sinceMs) {
  let total = 0;
  let online = 0;
  for (const c of checks) {
    if (c.t < sinceMs) continue;
    total++;
    if (c.status === 'online') online++;
  }
  return total ? (online / total) * 100 : null;
}

/** Verteilt Checks in gleich große Zeitfenster (ein Durchlauf, O(n)). */
function bucketize(checks, start, end, count) {
  const size = (end - start) / count;
  const buckets = Array.from({ length: count }, (_, i) => ({
    start: start + i * size,
    end: start + (i + 1) * size,
    total: 0, online: 0, offline: 0, degraded: 0, rtSum: 0, rtCount: 0,
  }));
  for (const c of checks) {
    if (c.t < start || c.t >= end) continue;
    const b = buckets[Math.min(count - 1, Math.floor((c.t - start) / size))];
    b.total++;
    b[c.status] = (b[c.status] ?? 0) + 1;
    // Antwortzeiten nur von erfolgreichen Checks – Timeouts würden die Kurve verfälschen.
    if (c.status === 'online' && Number.isFinite(c.responseTime)) {
      b.rtSum += c.responseTime;
      b.rtCount++;
    }
  }
  return buckets;
}

function uptimeClass(pct) {
  if (pct === null) return 'uptime-none';
  if (pct >= 99) return 'uptime-good';
  if (pct >= 95) return 'uptime-warn';
  return 'uptime-bad';
}

const fmtPct = (pct) => (pct === null ? '—' : `${pct >= 99.995 ? '100' : pct.toFixed(2)}%`);

function fmtDuration(ms) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} Min.`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours} Std. ${min % 60} Min.`;
  return `${Math.round(hours / 24)} Tage`;
}

function fmtAgo(ms) {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  if (abs < HOUR) return fmtRelative.format(Math.round(diff / 60_000), 'minute');
  if (abs < DAY) return fmtRelative.format(Math.round(diff / HOUR), 'hour');
  return fmtRelative.format(Math.round(diff / DAY), 'day');
}

// ─── Theme & Kopfbereich ───────────────────────
function applySite() {
  const { site = {}, theme = {} } = state.config;
  const vars = { accent: '--accent', secondary: '--secondary', success: '--success', danger: '--danger', warning: '--warning', background: '--bg' };
  for (const [key, cssVar] of Object.entries(vars)) {
    if (/^#[0-9a-f]{3,8}$/i.test(theme[key] ?? '')) document.documentElement.style.setProperty(cssVar, theme[key]);
  }
  if (theme.background) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.background);

  if (site.title) {
    $('#site-title').textContent = site.title;
    document.title = `${site.title} – Status`;
  }
  if (site.description) {
    $('#site-description').textContent = site.description;
    document.querySelector('meta[name="description"]')?.setAttribute('content', site.description);
  }
}

function renderLastUpdated() {
  const ts = Date.parse(state.history.lastUpdated);
  const el = $('#last-updated');
  const stale = $('#stale-warning');
  if (!Number.isFinite(ts)) {
    el.textContent = 'Noch kein Check gelaufen';
    stale.hidden = true;
    return;
  }
  el.textContent = `Letzter Check: ${fmtDateTime.format(ts)} (${fmtAgo(ts)})`;
  el.title = new Date(ts).toISOString();
  const age = Date.now() - ts;
  stale.hidden = age < STALE_AFTER_MS;
  stale.textContent = `Daten sind ${fmtDuration(age)} alt`;
}

// ─── Gesamtstatus & aktive Vorfälle ────────────
function allIncidents() {
  const auto = (state.history.incidents ?? []).map((inc) => {
    const started = Date.parse(inc.startedAt ?? inc.timestamp);
    const resolved = inc.resolvedAt ? Date.parse(inc.resolvedAt) : null;
    return { ...inc, source: 'auto', started, resolved, active: !resolved, sortKey: resolved ?? started };
  });
  const manual = state.manualIncidents.map((inc) => {
    const started = Date.parse(inc.createdAt);
    const last = inc.updates?.at(-1);
    return {
      ...inc,
      source: 'manual',
      started,
      active: inc.status !== 'resolved',
      sortKey: last ? Date.parse(last.timestamp) : started,
    };
  });
  return [...auto, ...manual].sort((a, b) => b.sortKey - a.sortKey);
}

function renderBanner(incidents) {
  const banner = $('#overall-status');
  const statuses = services().map((s) => latestOf(s.id)?.status ?? 'unknown');
  const count = (st) => statuses.filter((s) => s === st).length;
  const offline = count('offline');
  const degraded = count('degraded');
  const maintenance = incidents.some((i) => i.active && i.source === 'manual' && (i.status === 'maintenance' || i.severity === 'maintenance'));
  const plural = (n) => (n === 1 ? 'Service' : 'Services');

  let tone = 'success';
  let text = '✓ Alle Systeme sind betriebsbereit';
  if (offline) {
    tone = 'danger';
    text = `⚠ ${offline} ${plural(offline)} offline`;
    if (degraded) text += `, ${degraded} beeinträchtigt`;
  } else if (degraded) {
    tone = 'warning';
    text = `⚡ ${degraded} ${plural(degraded)} beeinträchtigt`;
  } else if (maintenance) {
    tone = 'info';
    text = '🔧 Geplante Wartungsarbeiten';
  } else if (statuses.length && statuses.every((s) => s === 'unknown')) {
    tone = 'info';
    text = 'Noch keine Messwerte vorhanden';
  }

  banner.dataset.tone = tone;
  banner.textContent = text;
  banner.hidden = false;

  const active = incidents.filter((i) => i.active);
  const box = $('#active-incidents');
  box.replaceChildren(...active.map(renderIncident));
  box.hidden = active.length === 0;
}

// ─── Service-Karten ────────────────────────────
function renderCards() {
  const now = Date.now();
  const cards = services().map((svc) => {
    const checks = checksOf(svc.id);
    const latest = checks.at(-1);
    const status = latest?.status ?? 'unknown';
    const meta = TYPE_META[svc.type] ?? { icon: '🔗', label: svc.type, css: 'type-http' };
    const d = latest?.details ?? {};

    const pills = [
      latest?.responseTime !== undefined && status !== 'offline' && h('span', { class: 'meta-pill', title: 'Antwortzeit' }, `⏱ ${latest.responseTime} ms`),
      d.players !== undefined && h('span', { class: 'meta-pill', title: 'Spieler' }, `👥 ${d.players}/${d.maxPlayers || '?'}`),
      d.version && h('span', { class: 'meta-pill', title: 'Version' }, `v${d.version}`),
      d.statusCode && h('span', { class: 'meta-pill', title: 'HTTP-Status' }, `HTTP ${d.statusCode}`),
      d.error && h('span', { class: 'meta-pill', title: d.error }, `⚠ ${d.error}`),
      latest && h('span', { class: 'meta-pill', title: fmtDateTime.format(latest.t) }, `⟳ ${fmtAgo(latest.t)}`),
    ];

    const up24 = uptimeSince(checks, now - DAY);
    const up30 = uptimeSince(checks, now - BAR_DAYS * DAY);

    const title = svc.link
      ? h('a', { href: svc.link, target: '_blank', rel: 'noopener' }, svc.name)
      : svc.name;

    return h('article', { class: 'service-card', 'aria-label': `${svc.name}: ${STATUS_LABEL[status]}` },
      h('div', { class: 'card-head' },
        h('div', { class: 'card-title' },
          h('div', { class: `type-icon ${meta.css}`, 'aria-hidden': 'true' }, meta.icon),
          h('div', {},
            h('h3', {}, title),
            h('p', { class: 'card-type' }, meta.label),
          ),
        ),
        h('div', { class: 'card-status' },
          h('span', { class: 'status-dot', dataset: { status }, 'aria-hidden': 'true' }),
          h('span', { class: 'badge', dataset: { status } }, STATUS_LABEL[status] ?? status),
        ),
      ),
      svc.description && h('p', { class: 'card-desc' }, svc.description),
      h('div', {},
        renderUptimeBar(checks, now),
        h('div', { class: 'bar-legend', 'aria-hidden': 'true' },
          h('span', {}, `vor ${BAR_DAYS} Tagen`), h('span', {}, 'Heute')),
      ),
      h('div', { class: 'card-foot' },
        h('div', { class: 'pills' }, pills),
        h('div', { class: 'uptime-stats' },
          h('span', { class: uptimeClass(up24) }, fmtPct(up24), h('small', {}, '24h')),
          h('span', { class: uptimeClass(up30) }, fmtPct(up30), h('small', {}, `${BAR_DAYS}d`)),
        ),
      ),
    );
  });

  $('#services-grid').replaceChildren(...cards);
}

function renderUptimeBar(checks, now) {
  // Tagesgenaue Segmente, ausgerichtet an lokaler Mitternacht.
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = today.getTime() - (BAR_DAYS - 1) * DAY;
  const buckets = bucketize(checks, start, today.getTime() + DAY, BAR_DAYS);

  const segments = buckets.map((b) => {
    let status;
    let detail = 'Keine Daten';
    if (b.total) {
      const pct = (b.online / b.total) * 100;
      status = b.offline === 0 && b.degraded === 0 ? 'online' : pct >= 95 ? 'degraded' : 'offline';
      detail = `${fmtPct(pct)} Uptime · ${b.total} Checks`;
      if (b.offline) detail += ` · ${b.offline}× offline`;
    }
    const label = `${fmtDay.format(b.start)}: ${detail}`;
    return h('span', { role: 'listitem', 'data-tip': label, 'aria-label': label, dataset: status ? { status } : {} });
  });

  return h('div', { class: 'uptime-bar', role: 'list', 'aria-label': `Verfügbarkeit der letzten ${BAR_DAYS} Tage` }, segments);
}

// ─── Tooltip (Maus, Touch & Tastatur) ──────────
function setupTooltip() {
  const tip = $('#tooltip');
  const show = (target) => {
    const text = target?.closest?.('[data-tip]')?.dataset.tip;
    if (!text) return hide();
    const rect = target.getBoundingClientRect();
    tip.textContent = text;
    tip.hidden = false;
    const half = tip.offsetWidth / 2 + 8;
    const x = Math.min(window.innerWidth - half, Math.max(half, rect.left + rect.width / 2));
    tip.style.left = `${x}px`;
    tip.style.top = `${rect.top}px`;
  };
  const hide = () => { tip.hidden = true; };

  document.addEventListener('pointerover', (e) => show(e.target));
  document.addEventListener('focusin', (e) => show(e.target));
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, { passive: true });
}

// ─── Charts ────────────────────────────────────
const PALETTE = () => {
  const css = getComputedStyle(document.documentElement);
  return ['--accent', '--secondary', '--success', '--warning'].map((v) => css.getPropertyValue(v).trim())
    .concat(['#a855f7', '#f97316', '#14b8a6', '#e879f9']);
};

function withAlpha(color, alpha) {
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return color;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderChartControls() {
  const select = $('#chart-service-select');
  const options = [h('option', { value: '__all__' }, 'Alle Services'),
    ...services().map((s) => h('option', { value: s.id }, s.name))];
  select.replaceChildren(...options);
  if (!services().some((s) => s.id === state.filter)) state.filter = '__all__';
  select.value = state.filter;
}

function bindChartControls() {
  document.querySelectorAll('.segmented [data-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.range = btn.dataset.range;
      document.querySelectorAll('.segmented [data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      updateCharts();
    });
  });
  $('#chart-service-select').addEventListener('change', (e) => {
    state.filter = e.target.value;
    updateCharts();
  });
}

function formatTick(value) {
  return state.range === '24h' ? fmtTime.format(value) : fmtShortDate.format(value);
}

function baseChartOptions(yOptions) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    spanGaps: true,
    plugins: {
      legend: { labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } },
      tooltip: {
        backgroundColor: '#111128',
        borderColor: 'rgba(255, 45, 149, 0.3)',
        borderWidth: 1,
        titleColor: '#fff',
        bodyColor: '#ccc',
        padding: 10,
        cornerRadius: 8,
        callbacks: { title: (items) => (items[0] ? fmtDateTime.format(items[0].parsed.x) : '') },
      },
    },
    scales: {
      x: {
        type: 'linear',
        grid: { color: 'rgba(26, 26, 62, 0.5)' },
        ticks: { color: '#6b7280', font: { size: 10 }, maxRotation: 0, autoSkipPadding: 16, callback: formatTick },
      },
      y: {
        grid: { color: 'rgba(26, 26, 62, 0.5)' },
        ticks: { color: '#6b7280', font: { size: 10 } },
        ...yOptions,
      },
    },
  };
}

function updateCharts() {
  if (typeof window.Chart === 'undefined') {
    $('#chart-fallback').hidden = false;
    return;
  }

  const { ms, buckets: count } = RANGES[state.range];
  const end = Date.now();
  const start = end - ms;
  const selected = state.filter === '__all__' ? services() : services().filter((s) => s.id === state.filter);
  const palette = PALETTE();

  const uptimeSets = [];
  const responseSets = [];
  selected.forEach((svc, i) => {
    const buckets = bucketize(checksOf(svc.id), start, end, count);
    if (!buckets.some((b) => b.total)) return;
    const color = palette[i % palette.length];
    const line = { label: svc.name, borderColor: color, borderWidth: 2, tension: 0.3, pointRadius: 0, pointHitRadius: 8, fill: true };
    const mid = (b) => (b.start + b.end) / 2;
    uptimeSets.push({ ...line, backgroundColor: withAlpha(color, 0.1),
      data: buckets.filter((b) => b.total).map((b) => ({ x: mid(b), y: +((b.online / b.total) * 100).toFixed(2) })) });
    responseSets.push({ ...line, backgroundColor: withAlpha(color, 0.08),
      data: buckets.filter((b) => b.rtCount).map((b) => ({ x: mid(b), y: Math.round(b.rtSum / b.rtCount) })) });
  });

  const showLegend = uptimeSets.length > 1;
  upsertChart('uptime', '#uptime-chart', uptimeSets, start, end, showLegend,
    { min: 0, max: 100, ticks: { color: '#6b7280', font: { size: 10 }, callback: (v) => `${v}%` } },
    (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`);
  upsertChart('response', '#response-chart', responseSets, start, end, showLegend,
    { beginAtZero: true, ticks: { color: '#6b7280', font: { size: 10 }, callback: (v) => `${v} ms` } },
    (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} ms`);
}

function upsertChart(key, selector, datasets, min, max, showLegend, yOptions, labelFn) {
  let chart = state.charts[key];
  if (!chart) {
    const options = baseChartOptions(yOptions);
    options.plugins.tooltip.callbacks.label = labelFn;
    chart = state.charts[key] = new window.Chart($(selector), { type: 'line', data: { datasets: [] }, options });
  }
  chart.data.datasets = datasets;
  chart.options.scales.x.min = min;
  chart.options.scales.x.max = max;
  chart.options.plugins.legend.display = showLegend;
  chart.update();
}

// ─── Vorfälle ──────────────────────────────────
function renderIncident(inc) {
  if (inc.source === 'auto') {
    const tone = inc.active ? (inc.status === 'degraded' ? 'degraded' : 'offline') : 'online';
    const icon = inc.active ? (tone === 'degraded' ? '🟡' : '🔴') : '🟢';
    const duration = (inc.resolved ?? Date.now()) - inc.started;
    return h('article', { class: 'incident', dataset: { status: tone } },
      h('div', { class: 'incident-head' },
        h('div', {},
          h('p', { class: 'incident-title' }, `${icon} ${inc.title}`),
          h('p', { class: 'incident-meta' },
            h('span', {}, inc.serviceName ?? inc.serviceId ?? ''),
            h('span', {}, `· ${fmtDateTime.format(inc.started)}`),
            h('span', {}, `· ${inc.active ? 'seit' : 'Dauer'} ${fmtDuration(duration)}`),
          ),
          inc.error && h('p', { class: 'incident-meta' }, `Fehler: ${inc.error}`),
        ),
        h('span', { class: 'badge', dataset: { status: tone } }, inc.active ? 'Laufend' : 'Behoben'),
      ),
    );
  }

  const tone = INCIDENT_TONE[inc.status] ?? 'degraded';
  const names = new Map(services().map((s) => [s.id, s.name]));
  const updates = (inc.updates ?? []).slice().reverse();

  return h('article', { class: 'incident', dataset: { status: tone } },
    h('div', { class: 'incident-head' },
      h('div', {},
        h('p', { class: 'incident-title' }, `${INCIDENT_ICON[inc.status] ?? '⚡'} ${inc.title}`),
        h('p', { class: 'incident-meta' },
          Number.isFinite(inc.started) && h('span', {}, fmtDateTime.format(inc.started)),
          (inc.services ?? []).map((id) => h('span', { class: 'meta-pill' }, names.get(id) ?? id)),
        ),
      ),
      h('span', { class: 'badge', dataset: { status: tone } }, STATUS_LABEL[inc.status] ?? inc.status),
    ),
    updates.length > 0 && h('ol', { class: 'timeline' },
      updates.map((u) => h('li', {},
        h('p', { class: 'timeline-status' }, `${INCIDENT_ICON[u.status] ?? '📝'} ${STATUS_LABEL[u.status] ?? u.status}`),
        u.message && h('p', { class: 'timeline-msg' }, u.message),
        h('p', { class: 'timeline-time' }, fmtDateTime.format(Date.parse(u.timestamp))),
      ))),
  );
}

function renderIncidentHistory(incidents) {
  const past = incidents.filter((i) => !i.active).slice(0, 20);
  $('#incidents-list').replaceChildren(...past.map(renderIncident));
  $('#incidents-list').hidden = past.length === 0;
  $('#no-incidents').hidden = past.length > 0;
  $('#incidents-section').hidden = false;
}

// ─── Ablauf ────────────────────────────────────
function render() {
  $('#loading-state').hidden = true;
  applySite();
  renderLastUpdated();

  if (!services().length) {
    $('#empty-state').hidden = false;
    return;
  }
  $('#empty-state').hidden = true;

  const incidents = allIncidents();
  renderBanner(incidents);
  renderCards();
  renderIncidentHistory(incidents);

  $('#charts-section').hidden = false;
  renderChartControls();
  updateCharts();
}

async function refresh() {
  try {
    await loadData();
    render();
  } catch (err) {
    console.error('[Minimaid] Fehler beim Laden der Status-Daten:', err);
    if (!state.history) {
      $('#loading-state').hidden = true;
      $('#empty-state').hidden = false;
      $('#last-updated').textContent = 'Status-Daten konnten nicht geladen werden';
    }
  }
}

setupTooltip();
bindChartControls();
await refresh();

setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderLastUpdated(); });
