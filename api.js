export class FinTrackAPIClient {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    this.token = null;
  }

  setToken(token) {
    this.token = token;
  }

  async request(endpoint, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const config = { method, headers };
    if (body) config.body = JSON.stringify(body);

    const res = await fetch(`${this.baseUrl}/index.php/apps/fintrack/api/v1/${endpoint}`, config);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'HTTP Error' }));
      throw new Error(err.message || res.statusText);
    }
    return res.json();
  }

  // --- Auth & Profile ---
  login(username, password) {
    return fetch(`${this.baseUrl}/index.php/apps/fintrack/api/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then(r => r.json());
  }

  // --- Accounts ---
  getAccounts() { return this.request('accounts'); }
  createAccount(data) { return this.request('accounts', 'POST', data); }
  updateAccount(id, data) { return this.request(`accounts/${id}`, 'PUT', data); }
  deleteAccount(id) { return this.request(`accounts/${id}`, 'DELETE'); }

  // --- Categories ---
  getCategories() { return this.request('categories'); }
  createCategory(data) { return this.request('categories', 'POST', data); }
  updateCategory(id, data) { return this.request(`categories/${id}`, 'PUT', data); }
  deleteCategory(id) { return this.request(`categories/${id}`, 'DELETE'); }

  // --- Transactions ---
  getTransactions(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`transactions${query ? '?' + query : ''}`);
  }
  createTransaction(data) { return this.request('transactions', 'POST', data); }
  updateTransaction(id, data) { return this.request(`transactions/${id}`, 'PUT', data); }
  deleteTransaction(id) { return this.request(`transactions/${id}`, 'DELETE'); }

  // --- Transfers ---
  getTransfers() { return this.request('transfers'); }
  createTransfer(data) { return this.request('transfers', 'POST', data); }
  deleteTransfer(id) { return this.request(`transfers/${id}`, 'DELETE'); }

  // --- Budgets ---
  getBudgets() { return this.request('budgets'); }
  createBudget(data) { return this.request('budgets', 'POST', data); }
  updateBudget(id, data) { return this.request(`budgets/${id}`, 'PUT', data); }
  deleteBudget(id) { return this.request(`budgets/${id}`, 'DELETE'); }

  // --- Recurring Transactions ---
  getRecurring() { return this.request('recurring'); }
  createRecurring(data) { return this.request('recurring', 'POST', data); }
  updateRecurring(id, data) { return this.request(`recurring/${id}`, 'PUT', data); }
  deleteRecurring(id) { return this.request(`recurring/${id}`, 'DELETE'); }

  // --- Dashboard Summary ---
  getDashboard() { return this.request('dashboard'); }
}