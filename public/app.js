const feed = document.getElementById('feed');
const meta = document.getElementById('meta');
const toggleBtn = document.getElementById('toggle');
const markAllBtn = document.getElementById('markall');

let view = 'unread'; // 'unread' | 'read'

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
    const res = await fetch(`/api/items?filter=${view}`, { cache: 'no-store' });
    const { items, status } = await res.json();
    if (!items.length) renderEmpty();
    else renderItems(items);

    const last = status?.lastRun ? fmtTime(status.lastRun) : '—';
    if (view === 'read') {
      meta.innerHTML = `${items.length} read · <a href="/admin">manage</a>`;
    } else {
      meta.innerHTML = `${items.length} active · checked ${esc(last)} · <a href="/admin">manage</a>`;
    }

    // Controls: mark-all only makes sense in the unread view with items present.
    toggleBtn.hidden = false;
    toggleBtn.textContent = view === 'read' ? 'Show unread' : 'Show read';
    markAllBtn.hidden = view === 'read' || items.length === 0;
  } catch (err) {
    meta.textContent = 'offline — retrying…';
  }
}

toggleBtn.addEventListener('click', () => {
  view = view === 'read' ? 'unread' : 'read';
  refresh();
});

markAllBtn.addEventListener('click', async () => {
  markAllBtn.disabled = true;
  try {
    await fetch('/api/items/dismiss-all', { method: 'POST' });
  } finally {
    markAllBtn.disabled = false;
  }
  refresh();
});

refresh();
setInterval(refresh, 60000);
