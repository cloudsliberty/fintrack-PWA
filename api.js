export class FinTrackAPIClient {
  constructor(baseUrl = '') {
    this.setBaseUrl(baseUrl);
    this.token = null;
  }

  setBaseUrl(url) {
    if (!url) {
      this.baseUrl = '';
      return;
    }
    // Clean trailing slash
    let cleanUrl = url.replace(/\/+$/, '');
    // Ensure protocol is present
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }
    this.baseUrl = cleanUrl;
  }

  setToken(token) {
    this.token = token;
  }

  async request(endpoint, method = 'GET', body = null) {
    if (!this.baseUrl) {
      throw new Error('Server URL is not configured.');
    }

    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const config = { method, headers };
    if (body) config.body = JSON.stringify(body);

    const fullUrl = `${this.baseUrl}/index.php/apps/fintrack/api/v1/${endpoint}`;
    const res = await fetch(fullUrl, config);
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: `HTTP Error ${res.status}` }));
      throw new Error(err.message || res.statusText);
    }
    return res.json();
  }

  // Auth
  async login(serverUrl, username, password) {
    this.setBaseUrl(serverUrl);
    const fullUrl = `${this.baseUrl}/index.php/apps/fintrack/api/v1/login`;
    
    const res = await fetch(fullUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: `Login failed with status ${res.status}` }));
      throw new Error(err.message || res.statusText);
    }
    
    return res.json();
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
