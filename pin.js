// FinTrack PWA — app.js
// Single-file SPA logic: bootstrap, Login Flow v2, PIN setup/unlock, router shell, and the
// generic CRUD form builder. Section views (accounts.js-equivalent content) are appended below
// in sections.js for readability, but everything shares this same FT_APP namespace.

const FT_VERSION = '1.0.0';

const FT_APP = {
  currentIdentityId: null,
  currentSession: null, // { serverUrl, loginName, appPassword }
  route: 'dashboard',
  installPromptEvent: null
};
window.FT_APP = FT_APP;

const root = () => document.getElementById('app-root');

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === null || c === undefined) return;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return el;
}

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch (_) {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function toast(message, isError = false) {
  const t = h('div', { class: `ft-toast ${isError ? 'ft-toast-error' : ''}` }, message);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

// ── Sync status (mirrors the Android app's icon-only status pill) ──
const FT_SYNC = (() => {
  let state = 'idle'; // idle | connecting | offline
  let inFlight = 0;
  const el = () => document.getElementById('sync-status-icon');

  function render() {
    const node = el();
    if (!node) return;
    node.className = 'sync-icon';
    if (inFlight > 0) {
      node.classList.add('spin');
      node.innerHTML = '&#8635;'; // spinner glyph
      node.title = 'Refreshing…';
    } else if (state === 'offline') {
      node.classList.add('sync-offline');
      node.innerHTML = '&#9729;&#8203;\u26A0'; // cloud + warning fallback glyph
      node.textContent = '⚠';
      node.title = 'Offline — showing cached data';
    } else {
      node.classList.add('sync-ok');
      node.textContent = '✓';
      node.title = 'Up to date';
    }
  }

  function begin() { inFlight++; render(); }
  function end(usedCache) { inFlight = Math.max(0, inFlight - 1); state = usedCache ? 'offline' : 'idle'; render(); }
  return { begin, end, render };
})();

// ── Cache-then-network data loading (same pattern as the Android app) ──
async function cachedLoad(cacheKey, networkFn) {
  const identityId = FT_APP.currentIdentityId;
  const key = FT_PIN.currentKey(identityId);
  const cached = key ? await FT_DB.getDecrypted(identityId, 'cache', cacheKey, key).catch(() => undefined) : undefined;

  FT_SYNC.begin();
  try {
    const fresh = await networkFn();
    if (key) FT_DB.putEncrypted(identityId, 'cache', cacheKey, key, fresh).catch(() => {});
    FT_SYNC.end(false);
    return { data: fresh, fromCache: false };
  } catch (err) {
    FT_SYNC.end(true);
    if (cached !== undefined) return { data: cached, fromCache: true };
    throw err;
  }
}

// ── Bootstrap ──
async function bootstrap() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
  setupInstallPrompt();

  const lastIdentityId = await FT_DB.getMeta('lastIdentityId');
  const identities = await FT_DB.listIdentities();

  if (!lastIdentityId || !identities.find((i) => i.id === lastIdentityId)) {
    renderLogin(identities);
    return;
  }

  FT_APP.currentIdentityId = lastIdentityId;
  const identity = identities.find((i) => i.id === lastIdentityId);
  if (identity.encSalt) {
    // Every fresh page load always re-asks for the PIN, full stop — the encryption key has to be
    // re-derived from it every time (nothing sensitive is ever kept in memory across a reload).
    // The timeout-aware "don't re-ask if only briefly backgrounded" leniency (isLockRequiredNow)
    // only matters for an already-unlocked warm session resuming from visibilitychange, not this.
    renderPinUnlock(identity);
  } else {
    // No local record for this identity at all (e.g. cleared storage, or login succeeded but Pin
    // Lock setup was never finished) — needs a fresh login to re-establish it.
    renderLogin(identities);
  }
}

// ── Login (Nextcloud Login Flow v2) ──
function renderLogin(identities) {
  root().replaceChildren(
    h('div', { class: 'auth-screen' }, [
      h('img', { src: 'icons/icon-192.png', class: 'auth-logo', alt: 'FinTrack' }),
      h('h1', {}, 'FinTrack'),
      h('p', { class: 'muted' }, 'Sign in to your Nextcloud server'),
      h('input', { id: 'server-url', type: 'url', placeholder: 'https://cloud.example.com', class: 'ft-input' }),
      h('button', { id: 'login-btn', class: 'ft-btn ft-btn-primary' }, 'Continue'),
      h('div', { id: 'login-status', class: 'muted', style: 'margin-top:12px' }),
      identities.length
        ? h('div', { style: 'margin-top:24px' }, [
            h('p', { class: 'muted' }, 'Or switch to a previous account:'),
            ...identities.map((i) =>
              h('button', { class: 'ft-btn ft-btn-outline', style: 'display:block;width:100%;margin-top:8px', onclick: () => switchIdentity(i) },
                `${i.loginName} @ ${i.serverUrl.replace(/^https?:\/\//, '')}`)
            )
          ])
        : null
    ])
  );

  document.getElementById('login-btn').addEventListener('click', async () => {
    const serverUrl = document.getElementById('server-url').value.trim();
    const statusEl = document.getElementById('login-status');
    if (!serverUrl) return;
    statusEl.textContent = 'Starting login…';
    try {
      // This is Nextcloud's official Login Flow v2 (the same protocol the Android app uses),
      // relayed through FinTrack's own login-proxy routes so it's reachable cross-origin — see
      // LoginProxyController in the Nextcloud app.
      const flow = await FT_API.initLoginFlow(serverUrl);
      const popup = window.open(flow.login, '_blank', 'noopener');
      statusEl.replaceChildren(
        'Complete the login in the tab that just opened, then come back here.',
        h('br'),
        !popup || popup.closed
          ? h('a', { href: flow.login, target: '_blank', rel: 'noopener' }, "Didn't open? Click here to log in.")
          : null,
        h('br'),
        h('button', { class: 'ft-btn ft-btn-text', id: 'cancel-login-btn', style: 'margin-top:8px' }, 'Cancel')
      );
      const stopPolling = pollForLogin(flow.poll.endpoint, flow.poll.token, serverUrl, statusEl);
      document.getElementById('cancel-login-btn').addEventListener('click', () => {
        stopPolling();
        statusEl.textContent = '';
      });
    } catch (err) {
      statusEl.textContent = err.message || 'Could not reach that server.';
    }
  });
}

async function switchIdentity(identity) {
  FT_APP.currentIdentityId = identity.id;
  await FT_DB.setMeta('lastIdentityId', identity.id);
  renderPinUnlock(identity);
}

function pollForLogin(endpoint, token, serverUrl, statusEl) {
  const intervalId = setInterval(async () => {
    try {
      const creds = await FT_API.pollLogin(endpoint, token, serverUrl);
      if (!creds) return; // still pending
      clearInterval(intervalId);
      statusEl.textContent = 'Signed in! Checking Pin Lock…';
      await onLoginSuccess(creds);
    } catch (err) {
      clearInterval(intervalId);
      statusEl.textContent = err.message || 'Login failed or expired — try again.';
    }
  }, 2000);
  // Give up after 5 minutes so a stale tab doesn't poll forever.
  const timeoutId = setTimeout(() => clearInterval(intervalId), 5 * 60 * 1000);
  return () => { clearInterval(intervalId); clearTimeout(timeoutId); };
}

async function onLoginSuccess(creds) {
  const identityId = await FT_CRYPTO.identityHash(creds.serverUrl, creds.loginName);
  const identities = await FT_DB.listIdentities();
  const existing = identities.find((i) => i.id === identityId);

  FT_APP.currentIdentityId = identityId;
  FT_APP.currentSession = creds;
  await FT_DB.setMeta('lastIdentityId', identityId);
  await FT_DB.saveIdentity({ id: identityId, serverUrl: creds.serverUrl, loginName: creds.loginName, encSalt: existing?.encSalt, cachedLockStatus: existing?.cachedLockStatus });

  // Always check the server's actual Pin Lock state — never assume based on stale local data.
  let status;
  try {
    status = await FT_API.getLockStatus(creds);
  } catch (err) {
    root().replaceChildren(h('div', { class: 'auth-screen' }, [
      h('p', {}, `Signed in, but couldn't reach FinTrack's API to check Pin Lock status: ${err.message}`),
      h('button', { class: 'ft-btn ft-btn-primary', onclick: () => onLoginSuccess(creds) }, 'Retry')
    ]));
    return;
  }

  if (status.enabled) {
    renderPinAdopt({ id: identityId, serverUrl: creds.serverUrl, loginName: creds.loginName }, creds, status);
  } else {
    renderPinSetup({ id: identityId, serverUrl: creds.serverUrl, loginName: creds.loginName }, creds);
  }
}

/** Server has NO Pin Lock configured yet for this Nextcloud account — offer to create one (same as Settings -> Pin Lock in the main app). */
function renderPinSetup(identity, session) {
  root().replaceChildren(
    h('div', { class: 'auth-screen' }, [
      h('img', { src: 'icons/icon-192.png', class: 'auth-logo', alt: 'FinTrack' }),
      h('h1', {}, 'FinTrack'),
      h('p', { class: 'muted' }, `Version ${FT_VERSION}`),
      h('h2', { style: 'margin-top:24px' }, 'Set up Pin Lock'),
      h('p', { class: 'muted' }, "This is the same Pin Lock as FinTrack's Settings in the main app — the PIN you set here works everywhere, and protects everything stored on this device too."),
      h('input', { id: 'pin1', type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: 'New PIN (4–6 digits)', class: 'ft-input' }),
      h('input', { id: 'pin2', type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: 'Confirm PIN', class: 'ft-input' }),
      h('label', { class: 'ft-field-label' }, 'Re-lock after (minutes in background)'),
      h('select', { id: 'pin-timeout', class: 'ft-input' }, [
        h('option', { value: '1' }, '1 minute'),
        h('option', { value: '5' }, '5 minutes'),
        h('option', { value: '10', selected: true }, '10 minutes'),
        h('option', { value: '15' }, '15 minutes'),
        h('option', { value: '30' }, '30 minutes')
      ]),
      h('div', { id: 'pin-setup-error', class: 'ft-error' }),
      h('button', { id: 'pin-setup-btn', class: 'ft-btn ft-btn-primary' }, 'Enable Pin Lock & Continue')
    ])
  );

  document.getElementById('pin-setup-btn').addEventListener('click', async () => {
    const pin1 = document.getElementById('pin1').value;
    const pin2 = document.getElementById('pin2').value;
    const timeoutMinutes = Number(document.getElementById('pin-timeout').value);
    const errEl = document.getElementById('pin-setup-error');
    if (!/^\d{4,6}$/.test(pin1)) { errEl.textContent = 'PIN must be 4–6 digits.'; return; }
    if (pin1 !== pin2) { errEl.textContent = "PINs don't match."; return; }
    try {
      await FT_PIN.setupNewPin(identity.id, pin1, timeoutMinutes, session);
      FT_APP.currentSession = session;
      enterApp();
    } catch (err) {
      errEl.textContent = err.message || 'Could not set up Pin Lock.';
    }
  });
}

/** Server already HAS a Pin Lock configured (set up in the main app, or another device) — confirm it, then adopt it locally. */
function renderPinAdopt(identity, session, status) {
  root().replaceChildren(
    h('div', { class: 'auth-screen' }, [
      h('img', { src: 'icons/icon-192.png', class: 'auth-logo', alt: 'FinTrack' }),
      h('h1', {}, 'FinTrack'),
      h('p', { class: 'muted' }, `Version ${FT_VERSION}`),
      h('h2', { style: 'margin-top:24px' }, 'Enter your Pin Lock PIN'),
      h('p', { class: 'muted' }, `${identity.loginName} @ ${identity.serverUrl.replace(/^https?:\/\//, '')} already has Pin Lock enabled (re-locks after ${status.timeoutMinutes} min). Enter it to set this device up too.`),
      h('input', { id: 'pin-adopt', type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: 'PIN', class: 'ft-input', autofocus: true }),
      h('div', { id: 'pin-adopt-error', class: 'ft-error' }),
      h('button', { id: 'pin-adopt-btn', class: 'ft-btn ft-btn-primary' }, 'Confirm')
    ])
  );

  async function tryAdopt() {
    const pin = document.getElementById('pin-adopt').value;
    const errEl = document.getElementById('pin-adopt-error');
    try {
      await FT_PIN.adoptExistingPin(identity.id, pin, session);
      FT_APP.currentSession = session;
      enterApp();
    } catch (err) {
      errEl.textContent = err.status === 423 ? (err.message || 'Too many attempts') : 'Incorrect PIN';
      document.getElementById('pin-adopt').value = '';
    }
  }
  document.getElementById('pin-adopt-btn').addEventListener('click', tryAdopt);
  document.getElementById('pin-adopt').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryAdopt(); });
}

function renderPinUnlock(identity) {
  root().replaceChildren(
    h('div', { class: 'auth-screen' }, [
      h('img', { src: 'icons/icon-192.png', class: 'auth-logo', alt: 'FinTrack' }),
      h('h1', {}, 'FinTrack'),
      h('p', { class: 'muted' }, `Version ${FT_VERSION}`),
      h('h2', { style: 'margin-top:24px' }, 'Enter your PIN'),
      h('p', { class: 'muted' }, `${identity.loginName} @ ${identity.serverUrl.replace(/^https?:\/\//, '')}`),
      h('input', { id: 'pin-unlock', type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: 'PIN', class: 'ft-input', autofocus: true }),
      h('div', { id: 'pin-unlock-error', class: 'ft-error' }),
      h('button', { id: 'pin-unlock-btn', class: 'ft-btn ft-btn-primary' }, 'Unlock'),
      h('button', { id: 'switch-account-btn', class: 'ft-btn ft-btn-text', style: 'margin-top:16px' }, 'Not you? Switch account'),
      h('button', { id: 'forgot-pin-btn', class: 'ft-btn ft-btn-text' }, 'Forgot PIN? Remove this account from this device')
    ])
  );

  async function tryUnlock() {
    const pin = document.getElementById('pin-unlock').value;
    const errEl = document.getElementById('pin-unlock-error');
    const btn = document.getElementById('pin-unlock-btn');
    btn.disabled = true;
    const result = await FT_PIN.tryUnlock(identity.id, pin);
    btn.disabled = false;
    if (!result.ok) {
      errEl.textContent = result.lockedUntil
        ? `${result.error} (try again after ${new Date(result.lockedUntil * 1000).toLocaleTimeString()})`
        : result.error;
      document.getElementById('pin-unlock').value = '';
      if (result.staleDevice) {
        setTimeout(async () => { await logout(); }, 2500);
      }
      return;
    }
    FT_APP.currentSession = await FT_DB.getDecrypted(identity.id, 'secure', 'session', FT_PIN.currentKey(identity.id));
    if (result.offline) toast('Offline — unlocked with your last verified PIN.');
    enterApp();
  }

  document.getElementById('pin-unlock-btn').addEventListener('click', tryUnlock);
  document.getElementById('pin-unlock').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
  document.getElementById('switch-account-btn').addEventListener('click', async () => {
    FT_APP.currentIdentityId = null;
    await FT_DB.setMeta('lastIdentityId', null);
    renderLogin(await FT_DB.listIdentities());
  });
  document.getElementById('forgot-pin-btn').addEventListener('click', async () => {
    if (!confirm('This removes all locally cached data for this account from this device (including its local copy of the Pin Lock check). Your Pin Lock itself stays enabled on the server — you\'ll confirm it again next time you log in here. Continue?')) return;
    await FT_DB.wipeIdentityData(identity.id);
    await FT_DB.deleteIdentity(identity.id);
    await FT_DB.setMeta('lastIdentityId', null);
    FT_PIN.lock();
    renderLogin(await FT_DB.listIdentities());
  });
}

function enterApp() {
  FT_APP.route = 'dashboard';
  renderShell();
}

async function logout() {
  FT_PIN.lock();
  await FT_DB.setMeta('lastIdentityId', null);
  FT_APP.currentIdentityId = null;
  FT_APP.currentSession = null;
  renderLogin(await FT_DB.listIdentities());
}

// ── App shell + router ──
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'transactions', label: 'Transactions', icon: '💳' },
  { id: 'accounts', label: 'Accounts', icon: '🏦' },
  { id: 'transfers', label: 'Transfers', icon: '🔁' },
  { id: 'recurring', label: 'Recurring', icon: '🔄' },
  { id: 'budgets', label: 'Budgets', icon: '🥧' },
  { id: 'categories', label: 'Categories & Tags', icon: '🏷️' },
  { id: 'currencies', label: 'Currencies', icon: '💱' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
  { id: 'external', label: 'External API', icon: '🔗' }
];

function renderShell() {
  root().replaceChildren(
    h('div', { class: 'app-shell' }, [
      h('header', { class: 'app-topbar' }, [
        h('div', { class: 'app-title' }, 'FinTrack'),
        h('div', { id: 'sync-status-icon', class: 'sync-icon' })
      ]),
      h('nav', { class: 'app-sidebar' }, NAV_ITEMS.map((item) =>
        h('button', {
          class: `nav-item ${FT_APP.route === item.id ? 'active' : ''}`,
          'data-route': item.id,
          onclick: () => navigate(item.id)
        }, [h('span', { class: 'nav-icon' }, item.icon), h('span', {}, item.label)])
      ).concat([h('button', { class: 'nav-item nav-logout', onclick: logout }, [h('span', { class: 'nav-icon' }, '🚪'), h('span', {}, 'Log Out')])])),
      h('main', { id: 'app-content', class: 'app-content' })
    ])
  );
  FT_SYNC.render();
  navigate(FT_APP.route);
}

const ROUTE_RENDERERS = {}; // populated by sections.js

function navigate(routeId) {
  FT_APP.route = routeId;
  document.querySelectorAll('.nav-item[data-route]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-route') === routeId);
  });
  const content = document.getElementById('app-content');
  content.replaceChildren(h('div', { class: 'loading-placeholder' }, 'Loading…'));
  const renderer = ROUTE_RENDERERS[routeId];
  if (renderer) renderer(content);
}

// ── Install prompt (Yes / No / Later) ──
function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    FT_APP.installPromptEvent = e;
    maybeShowInstallPrompt();
  });
}

function maybeShowInstallPrompt() {
  const dismissedForever = localStorage.getItem('ft_install_dismissed') === 'yes';
  const laterAt = Number(localStorage.getItem('ft_install_later_at') || 0);
  const stillInCooldown = laterAt && Date.now() - laterAt < 3 * 24 * 60 * 60 * 1000; // 3 days
  if (!FT_APP.installPromptEvent || dismissedForever || stillInCooldown) return;

  const overlay = h('div', { class: 'ft-modal-overlay' }, [
    h('div', { class: 'ft-modal' }, [
      h('img', { src: 'icons/icon-96.png', alt: '', style: 'width:48px;height:48px;border-radius:12px' }),
      h('h3', {}, 'Install FinTrack?'),
      h('p', { class: 'muted' }, 'Add FinTrack to your home screen for a faster, full-screen experience — works offline too.'),
      h('div', { class: 'ft-modal-actions' }, [
        h('button', { class: 'ft-btn ft-btn-text', onclick: () => { localStorage.setItem('ft_install_dismissed', 'yes'); overlay.remove(); } }, 'No'),
        h('button', { class: 'ft-btn ft-btn-outline', onclick: () => { localStorage.setItem('ft_install_later_at', String(Date.now())); overlay.remove(); } }, 'Later'),
        h('button', {
          class: 'ft-btn ft-btn-primary',
          onclick: async () => {
            overlay.remove();
            FT_APP.installPromptEvent.prompt();
            await FT_APP.installPromptEvent.userChoice;
            FT_APP.installPromptEvent = null;
          }
        }, 'Yes, install')
      ])
    ])
  ]);
  document.body.appendChild(overlay);
}

// ── Generic modal + form builder (reused by every entity section in sections.js) ──
function openModal(contentNode) {
  const overlay = h('div', { class: 'ft-modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } }, [contentNode]);
  document.body.appendChild(overlay);
  return overlay;
}

function closeModal(overlay) { overlay.remove(); }

/**
 * field: { key, label, type: 'text'|'number'|'date'|'select'|'checkbox'|'textarea', options?: [{value,label}], required? }
 */
function openFormModal({ title, fields, initialValues = {}, onSubmit }) {
  const inputs = {};
  const formBody = h('div', { class: 'ft-modal ft-form' }, [
    h('h3', {}, title),
    ...fields.map((f) => {
      const value = initialValues[f.key] ?? f.default ?? '';
      let inputEl;
      if (f.type === 'select') {
        inputEl = h('select', { class: 'ft-input', id: `f-${f.key}` },
          (f.options || []).map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
      } else if (f.type === 'checkbox') {
        inputEl = h('input', { type: 'checkbox', id: `f-${f.key}`, checked: !!value });
      } else if (f.type === 'textarea') {
        inputEl = h('textarea', { class: 'ft-input', id: `f-${f.key}` }, String(value));
      } else {
        inputEl = h('input', {
          class: 'ft-input', id: `f-${f.key}`, type: f.type || 'text',
          value: f.type === 'checkbox' ? undefined : String(value), placeholder: f.placeholder || ''
        });
      }
      inputs[f.key] = inputEl;
      return h('div', { class: 'ft-field' }, [h('label', {}, f.label), inputEl]);
    }),
    h('div', { id: 'form-error', class: 'ft-error' }),
    h('div', { class: 'ft-modal-actions' }, [
      h('button', { class: 'ft-btn ft-btn-text', onclick: () => closeModal(overlay) }, 'Cancel'),
      h('button', { class: 'ft-btn ft-btn-primary', id: 'form-submit-btn' }, 'Save')
    ])
  ]);
  const overlay = openModal(formBody);

  formBody.querySelector('#form-submit-btn').addEventListener('click', async () => {
    const values = {};
    for (const f of fields) {
      const el = inputs[f.key];
      if (f.type === 'checkbox') values[f.key] = el.checked;
      else if (f.type === 'number') values[f.key] = el.value === '' ? null : Number(el.value);
      else values[f.key] = el.value;
      if (f.required && (values[f.key] === '' || values[f.key] === null)) {
        formBody.querySelector('#form-error').textContent = `${f.label} is required.`;
        return;
      }
    }
    try {
      await onSubmit(values);
      closeModal(overlay);
    } catch (err) {
      formBody.querySelector('#form-error').textContent = err.message || 'Something went wrong.';
    }
  });
}

function confirmDialog(message, onConfirm) {
  const body = h('div', { class: 'ft-modal' }, [
    h('p', {}, message),
    h('div', { class: 'ft-modal-actions' }, [
      h('button', { class: 'ft-btn ft-btn-text', onclick: () => closeModal(overlay) }, 'Cancel'),
      h('button', { class: 'ft-btn ft-btn-danger', onclick: async () => { closeModal(overlay); await onConfirm(); } }, 'Delete')
    ])
  ]);
  const overlay = openModal(body);
}

// Re-lock a live, already-unlocked session if it's been hidden longer than the server-configured
// timeout — without this, the timeout only ever took effect across a full page reload.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !FT_APP.currentIdentityId || !FT_APP.currentSession) return;
  const required = await FT_PIN.isLockRequiredNow(FT_APP.currentIdentityId);
  if (required) {
    const identity = await FT_PIN.getIdentity(FT_APP.currentIdentityId);
    FT_PIN.lock();
    FT_APP.currentSession = null;
    renderPinUnlock(identity);
  }
});

window.addEventListener('DOMContentLoaded', bootstrap);
