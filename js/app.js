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
  if (FT_PIN.isEnabled(identity)) {
    renderPinUnlock(identity);
  } else {
    // No PIN configured (shouldn't normally happen — PIN setup is mandatory on first login —
    // but handle gracefully rather than getting stuck).
    renderPinSetup(identity, /*mandatory*/ true);
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
      // This is Nextcloud's official Login Flow v2 (the same protocol the Android app uses):
      // POST /index.php/login/v2 -> open the returned `login` URL for the person to authenticate
      // -> poll the returned `poll.endpoint` with `poll.token` until it returns the app password.
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
      const stopPolling = pollForLogin(flow.poll.endpoint, flow.poll.token, statusEl);
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
  if (FT_PIN.isEnabled(identity)) renderPinUnlock(identity);
  else renderPinSetup(identity, true);
}

function pollForLogin(endpoint, token, statusEl) {
  const intervalId = setInterval(async () => {
    try {
      const creds = await FT_API.pollLogin(endpoint, token);
      if (!creds) return; // still pending
      clearInterval(intervalId);
      statusEl.textContent = 'Signed in! Setting up this device…';
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

  if (existing && existing.pinEnabled) {
    // Re-login to an already-set-up identity: keep their PIN, just refresh the stored app
    // password (it may have been regenerated) once they unlock.
    await FT_DB.saveIdentity({ ...existing, serverUrl: creds.serverUrl, loginName: creds.loginName });
    renderPinUnlock(existing, creds);
  } else {
    await FT_DB.saveIdentity({ id: identityId, serverUrl: creds.serverUrl, loginName: creds.loginName, pinEnabled: false });
    renderPinSetup({ id: identityId, serverUrl: creds.serverUrl, loginName: creds.loginName }, true, creds);
  }
}

function renderPinSetup(identity, mandatory, pendingCreds) {
  root().replaceChildren(
    h('div', { class: 'auth-screen' }, [
      h('img', { src: 'icons/icon-192.png', class: 'auth-logo', alt: 'FinTrack' }),
      h('h1', {}, 'FinTrack'),
      h('p', { class: 'muted' }, `Version ${FT_VERSION}`),
      h('h2', { style: 'margin-top:24px' }, 'Set up a PIN'),
      h('p', { class: 'muted' }, 'This PIN protects FinTrack on this device and encrypts everything stored locally. You\'ll need it every time you open the app.'),
      h('input', { id: 'pin1', type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: 'New PIN (4–6 digits)', class: 'ft-input' }),
      h('input', { id: 'pin2', type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: 'Confirm PIN', class: 'ft-input' }),
      h('label', { class: 'ft-field-label' }, 'Re-lock after (minutes in background)'),
      h('select', { id: 'pin-timeout', class: 'ft-input' }, [
        h('option', { value: '0' }, 'Immediately'),
        h('option', { value: '1' }, '1 minute'),
        h('option', { value: '5', selected: true }, '5 minutes'),
        h('option', { value: '15' }, '15 minutes'),
        h('option', { value: '30' }, '30 minutes')
      ]),
      h('div', { id: 'pin-setup-error', class: 'ft-error' }),
      h('button', { id: 'pin-setup-btn', class: 'ft-btn ft-btn-primary' }, 'Enable PIN & Continue')
    ])
  );

  document.getElementById('pin-setup-btn').addEventListener('click', async () => {
    const pin1 = document.getElementById('pin1').value;
    const pin2 = document.getElementById('pin2').value;
    const timeoutMinutes = Number(document.getElementById('pin-timeout').value);
    const errEl = document.getElementById('pin-setup-error');
    if (!/^\d{4,6}$/.test(pin1)) { errEl.textContent = 'PIN must be 4–6 digits.'; return; }
    if (pin1 !== pin2) { errEl.textContent = "PINs don't match."; return; }

    const pinFields = await FT_PIN.buildPinFields(pin1, timeoutMinutes);
    const record = { id: identity.id, serverUrl: identity.serverUrl, loginName: identity.loginName, ...pinFields };
    await FT_DB.saveIdentity(record);
    await FT_PIN.unlockWithNewPin(identity.id, pin1, pinFields.encSalt);

    const creds = pendingCreds || FT_APP.currentSession;
    if (creds) {
      await FT_DB.putEncrypted(identity.id, 'secure', 'session', FT_PIN.currentKey(identity.id), creds);
      FT_APP.currentSession = creds;
    }
    enterApp();
  });
}

function renderPinUnlock(identity, pendingCreds) {
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
    const ok = await FT_PIN.verifyAndUnlock(identity.id, pin);
    if (!ok) { errEl.textContent = 'Incorrect PIN'; document.getElementById('pin-unlock').value = ''; return; }
    if (pendingCreds) {
      await FT_DB.putEncrypted(identity.id, 'secure', 'session', FT_PIN.currentKey(identity.id), pendingCreds);
      FT_APP.currentSession = pendingCreds;
    } else {
      FT_APP.currentSession = await FT_DB.getDecrypted(identity.id, 'secure', 'session', FT_PIN.currentKey(identity.id));
    }
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
    if (!confirm('This removes all locally cached data for this account from this device. You will need to log in again. Continue?')) return;
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

window.addEventListener('DOMContentLoaded', bootstrap);
