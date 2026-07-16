const feed = document.getElementById('feed');
const meta = document.getElementById('meta');
const toggleBtn = document.getElementById('toggle');
const markAllBtn = document.getElementById('markall');

let view = 'unread'; // 'unread' | 'read'

// Read/unread state lives in THIS browser only. Keyed by a stable per-item key so
// it survives re-polls and DB reseeds; a different browser/device sees everything
// unread until it marks read here.
const READ_STORE = 'nh_read';
let readSet = new Set(loadRead());

function loadRead() {
  try {
    return JSON.parse(localStorage.getItem(READ_STORE) || '[]');
  } catch {
    return [];
  }
}
function saveRead() {
  localStorage.setItem(READ_STORE, JSON.stringify([...readSet]));
}
function keyOf(it) {
  // dedupe_key is stable per alert; fall back to id.
  return it.dedupe_key ? `${it.source_type || ''}:${it.dedupe_key}` : `id:${it.id}`;
}

const TAGS = {
  flee: 'Flee',
  recall: 'Recall',
  quake: 'Quake',
  personal: 'For you',
};

// A "flee" card that isn't life-threatening (e.g. an air quality alert) shouldn't
// literally shout FLEE — soften the tag by severity.
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
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

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

    // Keep the local read set bounded to alerts that still exist.
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
    if (view === 'read') {
      meta.innerHTML = `${read.length} read · <a href="/admin">manage</a>`;
    } else {
      meta.innerHTML = `${unread.length} active · checked ${esc(last)} · <a href="/admin">manage</a>`;
    }

    // Controls: toggle always available; mark-all only in unread view with items.
    toggleBtn.hidden = false;
    toggleBtn.textContent = view === 'read' ? 'Show unread' : 'Show read';
    markAllBtn.hidden = view === 'read' || unread.length === 0;

    // Stash the latest unread keys so Mark-all can act without another fetch.
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

refresh();
setInterval(refresh, 60000);
