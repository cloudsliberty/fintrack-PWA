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

  // Set standard HTTP Basic Auth header using Nextcloud credentials/App Password
  setCredentials(username, passwordOrAppPassword) {
    const credentials = `${username}:${passwordOrAppPassword}`;
    this.authHeader = 'Basic ' + btoa(unescape(encodeURIComponent(credentials)));
  }

  async request(endpoint, method = 'GET', body = null) {
    if (!this.baseUrl) {
      throw new Error('Server URL is not configured.');
    }

    const headers = { 'Content-Type': 'application/json' };
    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }

    const config = { method, headers };
    if (body) config.body = JSON.stringify(body);

    const fullUrl = `${this.baseUrl}/index.php/apps/fintrack/api/v1/${endpoint}`;
    const res = await fetch(fullUrl, config);

    if (res.status === 401) {
      throw new Error('Authentication failed. Invalid Nextcloud credentials or App Password.');
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: `HTTP Error ${res.status}` }));
      throw new Error(err.message || res.statusText);
    }
    return res.json();
  }

  // Validate connection against Nextcloud native user/dashboard API
  async testConnection(serverUrl, username, passwordOrAppPassword) {
    this.setBaseUrl(serverUrl);
    this.setCredentials(username, passwordOrAppPassword);
    
    // Testing authentication via dashboard route
    return await this.request('dashboard');
  }

  // Accounts
  getAccounts() { return this.request('accounts'); }
  createAccount(data) { return this.request('accounts', 'POST', data); }
  updateAccount(id, data) { return this.request(`accounts/${id}`, 'PUT', data); }
  deleteAccount(id) { return this.request(`accounts/${id}`, 'DELETE'); }

  // Categories
  getCategories() { return this.request('categories'); }
  createCategory(data) { return this.request('categories', 'POST', data); }
  updateCategory(id, data) { return this.request(`categories/${id}`, 'PUT', data); }
  deleteCategory(id) { return this.request(`categories/${id}`, 'DELETE'); }

  // Transactions
  getTransactions(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`transactions${query ? '?' + query : ''}`);
  }
  createTransaction(data) { return this.request('transactions', 'POST', data); }
  updateTransaction(id, data) { return this.request(`transactions/${id}`, 'PUT', data); }
  deleteTransaction(id) { return this.request(`transactions/${id}`, 'DELETE'); }

  // Transfers
  getTransfers() { return this.request('transfers'); }
  createTransfer(data) { return this.request('transfers', 'POST', data); }
  deleteTransfer(id) { return this.request(`transfers/${id}`, 'DELETE'); }

  // Budgets
  getBudgets() { return this.request('budgets'); }
  createBudget(data) { return this.request('budgets', 'POST', data); }
  updateBudget(id, data) { return this.request(`budgets/${id}`, 'PUT', data); }
  deleteBudget(id) { return this.request(`budgets/${id}`, 'DELETE'); }

  // Recurring
  getRecurring() { return this.request('recurring'); }
  createRecurring(data) { return this.request('recurring', 'POST', data); }
  updateRecurring(id, data) { return this.request(`recurring/${id}`, 'PUT', data); }
  deleteRecurring(id) { return this.request(`recurring/${id}`, 'DELETE'); }

  // Dashboard
  getDashboard() { return this.request('dashboard'); }
}
