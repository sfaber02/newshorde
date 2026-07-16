// Admin client. If the server requires a local token (ADMIN_TOKEN set), we prompt
// once and store it; behind Cloudflare Access this is a no-op.
let catalog = [];
let token = localStorage.getItem('nh_admin_token') || '';

const $ = (id) => document.getElementById(id);

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['X-Admin-Token'] = token;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    const entered = prompt('Admin password:');
    if (entered) {
      token = entered;
      localStorage.setItem('nh_admin_token', token);
      return api(path, opts);
    }
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- add-source form --------------------------------------------------------
function renderFields() {
  const type = $('type').value;
  const meta = catalog.find((m) => m.type === type);
  $('type-desc').textContent = meta?.description || '';
  $('fields').innerHTML =
    `<label>Label</label><input id="f-label" value="${esc(meta?.label || '')}" />` +
    (meta?.fields || []).map((f) => {
      if (f.type === 'boolean') {
        return `<label><input type="checkbox" id="cfg-${f.key}" ${f.default ? 'checked' : ''}/> ${esc(f.label)}</label>`;
      }
      const val = f.default != null ? esc(f.default) : '';
      const t = f.type === 'number' ? 'number' : 'text';
      return `<label>${esc(f.label)}${f.required ? ' *' : ''}</label>
        <input id="cfg-${f.key}" type="${t}" value="${val}" step="any" />`;
    }).join('');
}

async function loadCatalog() {
  const data = await api('/api/catalog');
  catalog = data.catalog;
  $('type').innerHTML = catalog
    .map((m) => `<option value="${esc(m.type)}">${esc(m.label)}</option>`)
    .join('');
  renderFields();
}

async function addSource() {
  const type = $('type').value;
  const meta = catalog.find((m) => m.type === type);
  const cfg = {};
  for (const f of meta.fields || []) {
    const el = $(`cfg-${f.key}`);
    if (!el) continue;
    if (f.type === 'boolean') cfg[f.key] = el.checked;
    else if (f.type === 'number') cfg[f.key] = el.value === '' ? undefined : Number(el.value);
    else if (el.value !== '') cfg[f.key] = el.value;
  }
  try {
    await api('/api/sources', {
      method: 'POST',
      body: JSON.stringify({ type, label: $('f-label').value, config: cfg }),
    });
    toast('Source added');
    await loadSources();
    await api('/api/poll', { method: 'POST' }).catch(() => {});
    setTimeout(loadSources, 1500);
  } catch (e) {
    toast('Error: ' + e.message);
  }
}

// ---- source list ------------------------------------------------------------
async function loadSources() {
  const { sources, pullLog } = await api('/api/sources');
  const logById = Object.fromEntries(pullLog.map((p) => [p.source_id, p]));
  $('sources').innerHTML = sources.length
    ? sources.map((s) => {
        const log = logById[s.id];
        const stat = log
          ? (log.error
              ? `<span class="err">error: ${esc(log.error)}</span>`
              : `${log.kept_count}/${log.raw_count} kept<br/>${esc(log.pulled_at || '')}`)
          : 'not polled yet';
        return `
          <div class="source-row ${s.enabled ? '' : 'off'}">
            <div class="info">
              <div class="t">${esc(s.label)} <span class="d">(${esc(s.type)})</span></div>
              <div class="d">${esc(JSON.stringify(s.config))}</div>
            </div>
            <div class="stat">${stat}</div>
            <div>
              <button class="btn ghost" data-toggle="${s.id}" data-on="${s.enabled ? 1 : 0}" style="margin:0 0 6px;padding:4px 8px;font-size:12px">${s.enabled ? 'Disable' : 'Enable'}</button><br/>
              <button class="btn danger" data-del="${s.id}" style="margin:0;padding:4px 8px;font-size:12px">Delete</button>
            </div>
          </div>`;
      }).join('')
    : '<div class="field-help">No sources yet. Add one above.</div>';

  $('sources').querySelectorAll('[data-toggle]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/sources/${b.dataset.toggle}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: b.dataset.on !== '1' }),
      });
      loadSources();
    }));
  $('sources').querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this source and its items?')) return;
      await api(`/api/sources/${b.dataset.del}`, { method: 'DELETE' });
      loadSources();
    }));
}

$('type').addEventListener('change', renderFields);
$('add').addEventListener('click', addSource);
$('poll').addEventListener('click', async () => {
  toast('Polling…');
  await api('/api/poll', { method: 'POST' });
  toast('Poll complete');
  loadSources();
});

(async () => {
  try {
    await loadCatalog();
    await loadSources();
  } catch (e) {
    toast('Load failed: ' + e.message);
  }
})();
