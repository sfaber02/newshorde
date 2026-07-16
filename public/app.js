const feed = document.getElementById('feed');
const meta = document.getElementById('meta');

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

function renderAllClear() {
  feed.innerHTML = `
    <div class="allclear">
      <div class="glyph">🌿</div>
      <div class="big">ALL CLEAR</div>
      <div class="sub">Nothing needs your attention. Go back to your life.</div>
    </div>`;
}

function renderItems(items) {
  feed.innerHTML = items.map((it) => {
    const when = fmtTime(it.starts_at || it.first_seen);
    const link = it.link
      ? `<a href="${esc(it.link)}" target="_blank" rel="noopener">details ↗</a>`
      : '';
    return `
      <article class="card ${esc(it.category)} ${esc(it.severity)}">
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
    if (!items.length) renderAllClear();
    else renderItems(items);
    const last = status?.lastRun ? fmtTime(status.lastRun) : '—';
    meta.innerHTML = `${items.length} active · checked ${esc(last)} · <a href="/admin">manage</a>`;
  } catch (err) {
    meta.textContent = 'offline — retrying…';
  }
}

refresh();
setInterval(refresh, 60000);
