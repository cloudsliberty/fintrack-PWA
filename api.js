export class FinTrackAPIClient {
  constructor(baseUrl = '') {
    this.setBaseUrl(baseUrl);
    this.authHeader = null;
  }

  setBaseUrl(url) {
    if (!url) {
      this.baseUrl = '';
      return;
    }
    let cleanUrl = url.replace(/\/+$/, '');
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }
    this.baseUrl = cleanUrl;
  }

  setCredentials(username, appPassword) {
    const credentials = `${username}:${appPassword}`;
    this.authHeader = 'Basic ' + btoa(unescape(encodeURIComponent(credentials)));
  }

  // Step 1: Start Nextcloud Native Login Flow v2
  async initLoginFlowV2(serverUrl) {
    this.setBaseUrl(serverUrl);
    const res = await fetch(`${this.baseUrl}/index.php/login/v2`, {
      method: 'POST'
    });

    if (!res.ok) {
      throw new Error(`Failed to initialize Nextcloud auth: ${res.statusText}`);
    }
    return res.json(); // Returns { poll: { token, endpoint }, login: "..." }
  }

  // Step 2: Poll Nextcloud endpoint until user grants access
  async pollLoginFlowV2(pollEndpoint, token) {
    const formData = new URLSearchParams();
    formData.append('token', token);

    const res = await fetch(pollEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });

    if (res.status === 404) {
      return null; // User hasn't approved yet
    }

    if (!res.ok) {
      throw new Error('Authentication expired or failed.');
    }

    return res.json(); // Returns { server, loginName, appPassword }
  }

  async request(endpoint, method = 'GET', body = null) {
    if (!this.baseUrl) throw new Error('Server URL not configured.');

    const headers = { 'Content-Type': 'application/json' };
    if (this.authHeader) headers['Authorization'] = this.authHeader;

    const config = { method, headers };
    if (body) config.body = JSON.stringify(body);

    const fullUrl = `${this.baseUrl}/index.php/apps/fintrack/api/v1/${endpoint}`;
    const res = await fetch(fullUrl, config);

    if (res.status === 401) throw new Error('Unauthorized');
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: `HTTP Error ${res.status}` }));
      throw new Error(err.message || res.statusText);
    }
    return res.json();
  }

  getDashboard() { return this.request('dashboard'); }
  getTransactions(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`transactions${query ? '?' + query : ''}`);
  }
}
