const feed = document.getElementById('feed');
const meta = document.getElementById('meta');
const toggleBtn = document.getElementById('toggle');
const markAllBtn = document.getElementById('markall');
const weatherEl = document.getElementById('weather');
const locBtn = document.getElementById('loc');

let view = 'unread'; // 'unread' | 'read'

// ---- local per-browser state ------------------------------------------------
const READ_STORE = 'nh_read';
const LOC_STORE = 'nh_location';
let readSet = new Set(loadJSON(READ_STORE, []));
let userLoc = loadJSON(LOC_STORE, null); // { lat, lon, label }

function loadJSON(k, fallback) {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveRead() {
  localStorage.setItem(READ_STORE, JSON.stringify([...readSet]));
}
function saveLoc() {
  if (userLoc) localStorage.setItem(LOC_STORE, JSON.stringify(userLoc));
  else localStorage.removeItem(LOC_STORE);
}
function keyOf(it) {
  return it.dedupe_key ? `${it.source_type || ''}:${it.dedupe_key}` : `id:${it.id}`;
}

// ---- shared helpers ---------------------------------------------------------
const TAGS = { flee: 'Flee', recall: 'Recall', outbreak: 'Outbreak', quake: 'Quake', personal: 'For you' };

// Map an NWS shortForecast string to a simple emoji (day/night aware).
function wxEmoji(short, isDay = true) {
  const s = (short || '').toLowerCase();
  if (s.includes('thunder')) return '⛈️';
  if (/(snow|flurr|sleet|ice|wintry|blizzard)/.test(s)) return '🌨️';
  if (/(rain|shower|drizzle)/.test(s)) return '🌧️';
  if (/(fog|haze|smoke|mist)/.test(s)) return '🌫️';
  if (s.includes('wind')) return '💨';
  if (/(partly|mostly sunny|mostly clear)/.test(s)) return isDay ? '⛅' : '🌙';
  if (/(cloud|overcast)/.test(s)) return '☁️';
  if (/(sun|clear|fair)/.test(s)) return isDay ? '☀️' : '🌙';
  return isDay ? '🌡️' : '🌙';
}

// AQI color by level (0 good … 5 hazardous), readable on the dark background.
const AQI_COLORS = ['#34d399', '#eab308', '#f97316', '#ef4444', '#a855f7', '#e11d48'];
function tagFor(it) {
  if (it.category === 'flee') {
    if (it.severity === 'critical') return 'Flee';
    if (it.severity === 'warning') return 'Warning';
    return 'Alert';
  }
  return TAGS[it.category] || it.category;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtHour(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric' });
}

// ============================================================================
// WEATHER
// ============================================================================
function updateLocButton() {
  locBtn.textContent = userLoc ? `📍 ${userLoc.label}` : '📍 Location';
}

async function loadWeather() {
  if (!userLoc) {
    weatherEl.innerHTML = `
      <div class="wx">
        <div class="wx-head">
          <div class="wx-meta">
            <div class="wx-loc">📍 Set your location</div>
            <div class="wx-cond">Get a local forecast + weather alerts</div>
          </div>
          <button class="btn" id="wxSetLoc" style="margin-left:auto">Set location</button>
        </div>
      </div>`;
    document.getElementById('wxSetLoc').onclick = openLocModal;
    return;
  }
  try {
    const res = await fetch(`/api/forecast?lat=${userLoc.lat}&lon=${userLoc.lon}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('forecast unavailable');
    const data = await res.json();
    // Upgrade a coarse label (e.g. from geolocation) to the real place name.
    if (data.location && data.location !== userLoc.label) {
      userLoc.label = data.location;
      saveLoc();
      updateLocButton();
    }
    renderWeather(data);
  } catch (err) {
    weatherEl.innerHTML = `<div class="wx"><div class="wx-cond">Couldn't load the forecast for ${esc(userLoc.label)}. ${esc(String(err.message))}</div></div>`;
  }
}

function renderWeather(d) {
  const cur = d.current;
  const aq = d.airQuality;

  const nwsAlerts = (d.alerts || []).map((a) => {
    const cls = /extreme|severe/i.test(a.severity || '') ? '' : ' moderate';
    const label = `⚠ ${esc(a.event)}${a.headline ? ' — ' + esc(a.headline) : ''}`;
    return a.link
      ? `<a class="wx-alert${cls}" href="${esc(a.link)}" target="_blank" rel="noopener">${label}</a>`
      : `<div class="wx-alert${cls}">${label}</div>`;
  }).join('');

  // Surface bad air as its own banner when unhealthy — even if NWS issued no alert.
  const aqBanner = aq && aq.level >= 2
    ? `<div class="wx-alert" style="background:${AQI_COLORS[aq.level]}22;border-color:${AQI_COLORS[aq.level]}66;color:${AQI_COLORS[aq.level]}">😷 Air quality ${esc(aq.category)} — AQI ${aq.usAqi}${aq.pm25 != null ? `, PM2.5 ${aq.pm25}` : ''}</div>`
    : '';
  const alerts = aqBanner + nwsAlerts;

  const hourly = (d.hourly || []).map((h) => `
    <div class="wx-hour">
      <div class="h">${esc(fmtHour(h.time))}</div>
      <div class="emoji">${wxEmoji(h.short, h.isDaytime)}</div>
      <div class="t">${h.temp}°</div>
      ${h.precip != null ? `<div class="p">${h.precip}%</div>` : '<div class="p">&nbsp;</div>'}
      <div class="w">${esc((h.wind || '').replace(' mph', ''))}</div>
    </div>`).join('');

  const daily = (d.daily || []).map((p) => `
    <div class="wx-day">
      <div class="name">${esc(p.name)}</div>
      <div class="demoji">${wxEmoji(p.short, p.isDaytime)}</div>
      <div class="dshort">${esc(p.short)}</div>
      <div class="dp">${p.precip != null ? p.precip + '%' : ''}</div>
      <div class="dtemp">${p.temp}°</div>
    </div>`).join('');

  const fc = d.forecastUrl
    ? `<a class="wx-full" href="${esc(d.forecastUrl)}" target="_blank" rel="noopener">Full forecast ↗</a>`
    : '';

  weatherEl.innerHTML = `
    <div class="wx">
      <div class="wx-head">
        ${cur ? `<div class="wx-emoji">${wxEmoji(cur.short, cur.isDaytime)}</div>` : ''}
        ${cur ? `<div class="wx-temp">${cur.temp}°</div>` : ''}
        <div class="wx-meta">
          <div class="wx-loc">${esc(d.location)}</div>
          <div class="wx-cond">${cur ? esc(cur.short) : ''}</div>
        </div>
        <div class="wx-stats">
          ${cur ? `<div>💨 <b>${esc(cur.wind || '—')}</b></div>
          <div>🌧 <b>${cur.precip != null ? cur.precip + '%' : '—'}</b> precip</div>` : ''}
          ${aq ? `<div>😷 AQI <b style="color:${AQI_COLORS[aq.level]}">${aq.usAqi}</b> ${esc(aq.category.replace('for Sensitive Groups', '(sensitive)'))}</div>` : ''}
        </div>
      </div>
      ${alerts ? `<div class="wx-alerts">${alerts}</div>` : ''}
      ${hourly ? `<div class="wx-section-label">Next hours</div><div class="wx-hourly">${hourly}</div>` : ''}
      ${daily ? `<div class="wx-section-label">Next days</div><div class="wx-daily">${daily}</div>` : ''}
      ${fc}
    </div>`;
}

// ---- location modal ---------------------------------------------------------
const locModal = document.getElementById('locModal');
const locInput = document.getElementById('locInput');
const locErr = document.getElementById('locErr');

function openLocModal() {
  locErr.textContent = '';
  locInput.value = '';
  locModal.hidden = false;
  locInput.focus();
}
function closeLocModal() {
  locModal.hidden = true;
}

async function setLoc(lat, lon, label) {
  userLoc = { lat, lon, label: label || 'My location' };
  saveLoc();
  updateLocButton();
  closeLocModal();
  await loadWeather();
}

document.getElementById('locGeo').addEventListener('click', () => {
  if (!navigator.geolocation) { locErr.textContent = 'Geolocation not available.'; return; }
  locErr.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => setLoc(pos.coords.latitude, pos.coords.longitude, 'My location'),
    (err) => { locErr.textContent = 'Location denied: ' + err.message; },
    { timeout: 10000 }
  );
});

document.getElementById('locSave').addEventListener('click', async () => {
  const q = locInput.value.trim();
  if (!q) { closeLocModal(); return; }
  locErr.textContent = 'Looking up…';
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error('couldn’t find that place');
    const g = await res.json();
    await setLoc(g.lat, g.lon, g.label);
  } catch (err) {
    locErr.textContent = String(err.message);
  }
});

document.getElementById('locClear').addEventListener('click', () => {
  userLoc = null;
  saveLoc();
  updateLocButton();
  closeLocModal();
  loadWeather();
});
document.getElementById('locCancel').addEventListener('click', closeLocModal);
locBtn.addEventListener('click', openLocModal);
locModal.addEventListener('click', (e) => { if (e.target === locModal) closeLocModal(); });

// ============================================================================
// FEED
// ============================================================================
function renderEmpty() {
  if (view === 'read') {
    feed.innerHTML = `
      <div class="allclear">
        <div class="glyph">📭</div>
        <div class="big" style="color:var(--muted)">Nothing read yet</div>
        <div class="sub">Items you clear will show up here.</div>
      </div>`;
    return;
  }
  feed.innerHTML = `
    <div class="allclear">
      <div class="glyph">🌿</div>
      <div class="big">ALL CLEAR</div>
      <div class="sub">Nothing needs your attention. Go back to your life.</div>
    </div>`;
}

function renderItems(items) {
  const readClass = view === 'read' ? ' read' : '';
  feed.innerHTML = items.map((it) => {
    const when = fmtTime(it.starts_at || it.first_seen);
    const link = it.link
      ? `<a href="${esc(it.link)}" target="_blank" rel="noopener">details ↗</a>`
      : '';
    return `
      <article class="card ${esc(it.category)} ${esc(it.severity)}${readClass}">
        <span class="tag">${esc(tagFor(it))}</span>
        <h2>${esc(it.title)}</h2>
        ${it.body ? `<p>${esc(it.body)}</p>` : ''}
        <div class="foot">
          ${when ? `<span>${esc(when)}</span>` : ''}
          ${link}
          <span>· ${esc(it.source_label || '')}</span>
        </div>
      </article>`;
  }).join('');
}

async function refresh() {
  try {
    const res = await fetch('/api/items', { cache: 'no-store' });
    const { items, status } = await res.json();

    const present = new Set(items.map(keyOf));
    let pruned = false;
    for (const k of [...readSet]) if (!present.has(k)) { readSet.delete(k); pruned = true; }
    if (pruned) saveRead();

    const unread = items.filter((it) => !readSet.has(keyOf(it)));
    const read = items.filter((it) => readSet.has(keyOf(it)));
    const shown = view === 'read' ? read : unread;

    if (!shown.length) renderEmpty();
    else renderItems(shown);

    const last = status?.lastRun ? fmtTime(status.lastRun) : '—';
    meta.innerHTML = view === 'read'
      ? `${read.length} read · <a href="/admin">manage</a>`
      : `${unread.length} active · checked ${esc(last)} · <a href="/admin">manage</a>`;

    toggleBtn.hidden = false;
    toggleBtn.textContent = view === 'read' ? 'Show unread' : 'Show read';
    markAllBtn.hidden = view === 'read' || unread.length === 0;
    markAllBtn._keys = unread.map(keyOf);
  } catch (err) {
    meta.textContent = 'offline — retrying…';
  }
}

toggleBtn.addEventListener('click', () => {
  view = view === 'read' ? 'unread' : 'read';
  refresh();
});
markAllBtn.addEventListener('click', () => {
  for (const k of markAllBtn._keys || []) readSet.add(k);
  saveRead();
  refresh();
});

// ---- boot -------------------------------------------------------------------
const TAGLINES = [
  "“I don't wanna know unless it's gonna kill me”",
  "“That which does not kill me, is fucking irrelevant to me”",
];
const taglineEl = document.querySelector('.tagline');
if (taglineEl) taglineEl.textContent = TAGLINES[Math.floor(Math.random() * TAGLINES.length)];

updateLocButton();
loadWeather();
refresh();
setInterval(refresh, 60000);
setInterval(loadWeather, 10 * 60 * 1000);
