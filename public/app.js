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
let wxItems = []; // location weather/air alerts, merged into the feed client-side

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
// HEADLINES — the only three things that matter
// ============================================================================
function updateLocButton() {
  locBtn.textContent = userLoc ? `📍 ${userLoc.label}` : '📍 Location';
}

// Color per weather mood.
const MOOD_COLORS = {
  hot: '#ff6b35', cold: '#4dd0ff', rain: '#5b8def', snow: '#c9ecff',
  storm: '#b16cff', nice: '#ffd60a', chilly: '#8fbcff', meh: '#9aa3b2',
};
const MOOD_EMOJI = {
  hot: '🥵', cold: '🥶', rain: '🌧️', snow: '❄️',
  storm: '⛈️', nice: '☀️', chilly: '🧥', meh: '🤷',
};

async function loadHeadlines() {
  try {
    const q = userLoc ? `?lat=${userLoc.lat}&lon=${userLoc.lon}` : '';
    const res = await fetch(`/api/headlines${q}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('headlines unavailable');
    const data = await res.json();
    // Upgrade a coarse label (e.g. from geolocation) to the real place name.
    if (data.weather?.location && data.weather.location !== userLoc?.label) {
      userLoc.label = data.weather.location;
      saveLoc();
      updateLocButton();
    }
    renderHeadlines(data);
    // Location weather alerts + unhealthy air become feed cards (read/unread like
    // recalls). Location is client-side, so we merge them in here, not server-side.
    wxItems = mapWxItems(data.alerts, data.airQuality);
    refresh();
  } catch {
    /* leave whatever's there */
  }
}

// Turn NWS alerts + a bad AQI reading into feed-item-shaped cards.
function mapWxItems(alerts, aq) {
  const out = [];
  for (const a of alerts || []) {
    const sev = /extreme/i.test(a.severity || '')
      ? 'critical'
      : /severe/i.test(a.severity || '')
      ? 'warning'
      : 'info';
    out.push({
      source_type: 'nws_wx',
      dedupe_key: `${a.event}|${a.area || ''}|${a.expires || ''}`,
      category: 'flee',
      severity: sev,
      title: a.event,
      body: a.headline || '',
      link: a.link || '',
      starts_at: null,
      first_seen: null,
      source_label: 'Weather · ' + (userLoc?.label || 'your area'),
    });
  }
  if (aq && aq.level >= 2) {
    out.push({
      source_type: 'aqi',
      dedupe_key: `aqi|${aq.category}`,
      category: 'flee',
      severity: aq.level >= 3 ? 'warning' : 'info',
      title: `Air quality: ${aq.category} (AQI ${aq.usAqi})`,
      body: `😷 Unhealthy air${aq.pm25 != null ? ` — PM2.5 ${aq.pm25}` : ''}. Limit time outside.`,
      link: '',
      starts_at: null,
      first_seen: null,
      source_label: 'Air quality · ' + (userLoc?.label || 'your area'),
    });
  }
  return out;
}

// A sparkline for the ketchup market — the area under the line is filled with a
// wall of actual tomatoes (HTML emoji, clipped to the area so they stay round),
// with the price line drawn on top. Jank as funk, as requested.
function sparkline(series) {
  const vals = series.map((p) => p.price);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const n = vals.length;
  const pts = vals.map((v, i) => ({
    x: (i / (n - 1)) * 100,
    y: 6 + (1 - (v - min) / span) * 88, // % from top, 6..94
  }));
  const line = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  // Clip the tomato layer to everything below the price line.
  const clip = `polygon(0% 100%, ${pts.map((p) => `${p.x.toFixed(2)}% ${p.y.toFixed(2)}%`).join(', ')}, 100% 100%)`;
  return `
    <div class="ketchup-graph">
      <div class="tomato-fill" style="clip-path:${clip};-webkit-clip-path:${clip}"></div>
      <svg class="ketchup-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${line}" fill="none" stroke="#e63946" stroke-width="2"
          stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
      </svg>
    </div>`;
}

function renderHeadlines(d) {
  // Three big colorful sentences that just run together and wrap however they
  // damn well please. No tiles. Graph tags along under the ketchup line.
  const sentences = [];

  // 1. Iggy Pop — the important one.
  if (d.iggy) {
    const cls = d.iggy.alive ? 'sx-iggy' : 'sx-iggy dead';
    sentences.push(`<span class="sx ${cls}">${esc(d.iggy.sentence)}</span>`);
  }

  // 2. The weather vibe (with the city tacked on).
  if (d.weather) {
    const color = MOOD_COLORS[d.weather.mood] || '#9aa3b2';
    const emoji = MOOD_EMOJI[d.weather.mood] || '🌡️';
    const city = (d.weather.location || '').split(',')[0].trim();
    const where = city ? ` in ${city}` : '';
    sentences.push(`<span class="sx" style="color:${color}">${esc(d.weather.text + where)} ${emoji}</span>`);
  } else {
    sentences.push(`<span class="sx" style="color:#9aa3b2">the weather's a mystery until you <button class="linkbtn" id="hlSetLoc">set your location</button>.</span>`);
  }

  // 3. Did any nukes go off? (peace sign = we're good)
  if (d.nuke) {
    const color = d.nuke.clear ? 'var(--clear)' : '#ff3b30';
    sentences.push(`<span class="sx" style="color:${color}">${esc(d.nuke.sentence)}</span>`);
  }

  // 4. The price of ketchup — real BLS producer price index.
  let graph = '';
  if (d.ketchup) {
    const k = d.ketchup;
    const up = k.direction === 'up';
    const moveColor = up ? '#ff6b6b' : '#30d158';
    const word = up ? 'up' : 'down';
    const asOf = new Date(k.asOf + 'T00:00:00').toLocaleDateString([], { month: 'long', year: 'numeric' });
    sentences.push(`<span class="sx" style="color:#e63946">The price of ketchup is <span style="color:${moveColor}">${word} ${Math.abs(k.changePct).toFixed(4)}%</span> this month <img class="tomato-emoji" src="/tomato3.png" alt="tomato" />.</span>`);
    graph = `
      <div class="ketchup-wrap">
        ${sparkline(k.series)}
        <div class="ketchup-cap">month over month · ${esc(k.source)} · ${esc(asOf)}</div>
      </div>`;
  }

  weatherEl.innerHTML = `<div class="headlines"><p class="blob">${sentences.join(' ')}</p>${graph}</div>`;
  const setLoc = document.getElementById('hlSetLoc');
  if (setLoc) setLoc.onclick = openLocModal;
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
  await loadHeadlines();
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
  loadHeadlines();
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
    const { items: serverItems, status } = await res.json();
    // Location weather/air alerts ride at the top of the same feed.
    const items = [...wxItems, ...serverItems];

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
loadHeadlines();
refresh();
setInterval(refresh, 60000);
setInterval(loadHeadlines, 10 * 60 * 1000);
