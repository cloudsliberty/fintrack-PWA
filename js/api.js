// FinTrack PWA — api.js
//
// Talks to the same Nextcloud FinTrack REST API the Android app uses: Login Flow v2 for
// authentication (server URL -> browser login -> polled app password), then HTTP Basic Auth
// (login name + app password) on every subsequent request — see the "Internal REST API" and
// "Public/External API" sections of the FinTrack manual.
//
// IMPORTANT — CORS: this API is designed for same-origin/session use inside Nextcloud's own page
// shell. Calling it from a separately-hosted PWA is a genuinely cross-origin request, and Nextcloud
// does not send permissive CORS headers by default. For this PWA to reach your server you'll
// likely need to either host it on the same origin as Nextcloud (e.g. a static path behind the
// same reverse proxy) or add CORS headers for this PWA's origin on your web server in front of
// Nextcloud. See README.md.

const FT_API = (() => {
  function normalizeServer(url) {
    return url.replace(/\/+$/, '');
  }

  async function initLoginFlow(serverUrl) {
    const res = await fetch(`${normalizeServer(serverUrl)}/index.php/login/v2`, {
      method: 'POST',
      headers: { 'OCS-APIREQUEST': 'true' }
    });
    if (!res.ok) throw new Error(`Could not start login (HTTP ${res.status}). Check the server address.`);
    return res.json(); // { poll: { token, endpoint }, login: "https://.../login/v2/flow/..." }
  }

  /** Polls once. Returns null while the person hasn't finished logging in yet in the opened tab, or the credentials once they have. */
  async function pollLogin(pollEndpoint, pollToken) {
    const res = await fetch(pollEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'OCS-APIREQUEST': 'true' },
      body: `token=${encodeURIComponent(pollToken)}`
    });
    if (res.status === 404) return null; // not completed yet
    if (!res.ok) throw new Error(`Login poll failed (HTTP ${res.status}).`);
    const data = await res.json(); // { server, loginName, appPassword }
    return { serverUrl: normalizeServer(data.server), loginName: data.loginName, appPassword: data.appPassword };
  }

  function authHeader(session) {
    const creds = btoa(unescape(encodeURIComponent(`${session.loginName}:${session.appPassword}`)));
    return { Authorization: `Basic ${creds}`, 'OCS-APIREQUEST': 'true' };
  }

  async function request(session, method, path, body) {
    const url = `${normalizeServer(session.serverUrl)}/index.php/apps/fintrack/${path}`;
    const res = await fetch(url, {
      method,
      mode: 'cors',
      headers: { ...authHeader(session), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson && errJson.error) message = errJson.error;
      } catch (_) { /* body wasn't JSON */ }
      throw new Error(message);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  function qs(params) {
    const usp = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') usp.set(k, v);
    });
    const s = usp.toString();
    return s ? `?${s}` : '';
  }

  return {
    initLoginFlow, pollLogin,

    // ── Accounts ──
    getAccounts: (s) => request(s, 'GET', 'api/accounts'),
    createAccount: (s, body) => request(s, 'POST', 'api/accounts', body),
    updateAccount: (s, id, body) => request(s, 'PUT', `api/accounts/${id}`, body),
    deleteAccount: (s, id) => request(s, 'DELETE', `api/accounts/${id}`),

    // ── Transactions ──
    getTransactions: (s, filters) => request(s, 'GET', `api/transactions${qs(filters)}`),
    createTransaction: (s, body) => request(s, 'POST', 'api/transactions', body),
    importTransactions: (s, body) => request(s, 'POST', 'api/transactions/import', body),
    updateTransaction: (s, id, body) => request(s, 'PUT', `api/transactions/${id}`, body),
    deleteTransaction: (s, id) => request(s, 'DELETE', `api/transactions/${id}`),

    // ── Transfers ──
    getTransfers: (s) => request(s, 'GET', 'api/transfers'),
    createTransfer: (s, body) => request(s, 'POST', 'api/transfers', body),
    deleteTransfer: (s, id) => request(s, 'DELETE', `api/transfers/${id}`),

    // ── Budgets ──
    getBudgets: (s) => request(s, 'GET', 'api/budgets'),
    createBudget: (s, body) => request(s, 'POST', 'api/budgets', body),
    updateBudget: (s, id, body) => request(s, 'PUT', `api/budgets/${id}`, body),
    deleteBudget: (s, id) => request(s, 'DELETE', `api/budgets/${id}`),

    // ── Categories ──
    getCategories: (s) => request(s, 'GET', 'api/categories'),
    createCategory: (s, body) => request(s, 'POST', 'api/categories', body),
    updateCategory: (s, id, body) => request(s, 'PUT', `api/categories/${id}`, body),
    deleteCategory: (s, id) => request(s, 'DELETE', `api/categories/${id}`),

    // ── Currencies ──
    getCurrencies: (s) => request(s, 'GET', 'api/currencies'),
    createCurrency: (s, body) => request(s, 'POST', 'api/currencies', body),
    updateCurrency: (s, id, body) => request(s, 'PUT', `api/currencies/${id}`, body),
    deleteCurrency: (s, id) => request(s, 'DELETE', `api/currencies/${id}`),

    // ── Recurring ──
    getRecurring: (s) => request(s, 'GET', 'api/recurring'),
    createRecurring: (s, body) => request(s, 'POST', 'api/recurring', body),
    updateRecurring: (s, id, body) => request(s, 'PUT', `api/recurring/${id}`, body),
    deleteRecurring: (s, id) => request(s, 'DELETE', `api/recurring/${id}`),
    postRecurring: (s, id) => request(s, 'POST', `api/recurring/${id}/post`),

    // ── Summary / settings / tags / token ──
    getSummary: (s) => request(s, 'GET', 'api/summary'),
    getSettings: (s) => request(s, 'GET', 'api/settings'),
    saveSettings: (s, body) => request(s, 'POST', 'api/settings', body),
    getTags: (s) => request(s, 'GET', 'api/tags'),
    saveTags: (s, tags) => request(s, 'POST', 'api/tags', { tags }),
    getToken: (s) => request(s, 'GET', 'api/token'),
    regenerateToken: (s) => request(s, 'POST', 'api/token/regenerate'),

    // ── External / token-authenticated API (for the External API settings page) ──
    externalGetAccounts: (s, token) => request(s, 'GET', `external/accounts?token=${encodeURIComponent(token)}`),
    externalGetCategories: (s, token) => request(s, 'GET', `external/categories?token=${encodeURIComponent(token)}`),
    externalCreateCategory: (s, token, body) => request(s, 'POST', `external/categories?token=${encodeURIComponent(token)}`, body),
    externalSubmit: (s, token, body) => request(s, 'POST', `external/submit?token=${encodeURIComponent(token)}`, body),
    quickAddUrl: (serverUrl, token, params) =>
      `${normalizeServer(serverUrl)}/index.php/apps/fintrack/external/quick-add${qs({ key: token, ...params })}`
  };
})();
