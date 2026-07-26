// FinTrack PWA — sections.js
// One route renderer per nav item, all sharing the FT_APP session + cachedLoad() + openFormModal()
// helpers from app.js. This is where every endpoint in the FinTrack manual gets a UI surface —
// deliberately more complete than the Android app's "basic options" (bulk CSV import, external
// API token management, full currency/category/tag CRUD, recurring "post now", etc).

function session() { return FT_APP.currentSession; }

function txKey(f = {}) { return `transactions:${f.accountId || ''}:${f.type || ''}:${f.category || ''}:${f.from || ''}:${f.to || ''}`; }

// ── Dashboard ──
ROUTE_RENDERERS.dashboard = async function (content) {
  try {
    const [{ data: summary }, { data: accounts }, { data: transactions }, { data: budgets }] = await Promise.all([
      cachedLoad('summary', () => FT_API.getSummary(session())),
      cachedLoad('accounts', () => FT_API.getAccounts(session())),
      cachedLoad(txKey(), () => FT_API.getTransactions(session(), { limit: 500 })),
      cachedLoad('budgets', () => FT_API.getBudgets(session()))
    ]);

    const base = summary.baseCurrency || summary.base_currency || 'USD';
    const baseAccounts = accounts.filter((a) => a.currency === base && a.active);
    const netByAccount = {};
    transactions.filter((t) => t.currency === base).forEach((t) => {
      netByAccount[t.accountId] = (netByAccount[t.accountId] || 0) + (t.type === 'income' ? t.amount : -t.amount);
    });
    const totalAssets = baseAccounts.filter((a) => a.type === 'asset').reduce((s, a) => s + (netByAccount[a.id] || 0), 0);
    const totalLiabilities = baseAccounts.filter((a) => a.type === 'liability').reduce((s, a) => s + (netByAccount[a.id] || 0), 0);
    const netWorth = totalAssets - totalLiabilities;
    const baseTx = transactions.filter((t) => t.currency === base);
    const cashFlow = baseTx.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);

    const catTotals = {};
    baseTx.filter((t) => t.type === 'expense' && t.category).forEach((t) => { catTotals[t.category] = (catTotals[t.category] || 0) + t.amount; });
    const topCategories = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const recent = [...transactions].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);

    content.replaceChildren(
      h('div', { class: 'section' }, [
        h('div', { class: 'stat-grid' }, [
          statCard('Net Worth', formatMoney(netWorth, base)),
          statCard('Cash Flow', formatMoney(cashFlow, base), cashFlow >= 0 ? 'green' : 'red'),
          statCard('Total Assets', formatMoney(totalAssets, base)),
          statCard('Total Liabilities', formatMoney(totalLiabilities, base))
        ]),
        budgets.length ? h('h3', {}, 'Active Budgets') : null,
        ...budgets.filter((b) => b.active).map((b) => budgetRow(b, transactions)),
        topCategories.length ? h('h3', {}, 'Top Spending Categories') : null,
        ...topCategories.map(([cat, total]) => h('div', { class: 'list-row' }, [h('span', {}, cat), h('span', {}, formatMoney(total, base))])),
        h('h3', {}, 'Recent Transactions'),
        ...(recent.length ? recent.map((t) => txSummaryRow(t, accounts)) : [h('p', { class: 'muted' }, 'No transactions yet.')])
      ])
    );
  } catch (err) {
    content.replaceChildren(errorBox(err, () => ROUTE_RENDERERS.dashboard(content)));
  }
};

function statCard(label, value, color) {
  return h('div', { class: 'stat-card' }, [
    h('div', { class: 'stat-label' }, label),
    h('div', { class: `stat-value ${color ? 'c-' + color : ''}` }, value)
  ]);
}

function budgetRow(budget, transactions) {
  const spent = transactions
    .filter((t) => t.type === 'expense' && t.currency === budget.currency && (!budget.category || (t.category || '').toLowerCase() === budget.category.toLowerCase()))
    .reduce((s, t) => s + t.amount, 0);
  const ratio = budget.limitAmt > 0 ? Math.min(1, spent / budget.limitAmt) : 0;
  return h('div', { class: 'budget-row' }, [
    h('div', { class: 'list-row' }, [h('strong', {}, budget.name), h('span', {}, `${formatMoney(spent, budget.currency)} / ${formatMoney(budget.limitAmt, budget.currency)}`)]),
    h('div', { class: 'progress-track' }, [h('div', { class: `progress-fill ${ratio >= 1 ? 'over' : ''}`, style: `width:${ratio * 100}%` })])
  ]);
}

function txSummaryRow(tx, accounts) {
  const account = accounts.find((a) => a.id === tx.accountId);
  const isIncome = tx.type === 'income';
  return h('div', { class: 'list-row' }, [
    h('div', {}, [
      h('div', {}, tx.description || tx.category || 'Untitled'),
      h('div', { class: 'muted small' }, [tx.date, account ? account.name : null, tx.category].filter(Boolean).join(' · '))
    ]),
    h('span', { class: isIncome ? 'c-green' : 'c-red' }, `${isIncome ? '+' : '-'}${formatMoney(tx.amount, tx.currency)}`)
  ]);
}

function errorBox(err, onRetry) {
  return h('div', { class: 'error-box' }, [
    h('p', {}, err.message || 'Something went wrong.'),
    h('button', { class: 'ft-btn ft-btn-outline', onclick: onRetry }, 'Retry')
  ]);
}

// ── Accounts ──
const ACCOUNT_TYPES = [
  { value: 'asset', label: 'Asset' }, { value: 'expense', label: 'Expense' },
  { value: 'revenue', label: 'Revenue' }, { value: 'liability', label: 'Liability' }
];

ROUTE_RENDERERS.accounts = async function (content) {
  try {
    const [{ data: accounts }, { data: currencies }] = await Promise.all([
      cachedLoad('accounts', () => FT_API.getAccounts(session())),
      cachedLoad('currencies', () => FT_API.getCurrencies(session()))
    ]);

    function openAccountForm(account) {
      openFormModal({
        title: account ? 'Edit Account' : 'New Account',
        fields: [
          { key: 'name', label: 'Name', required: true },
          { key: 'type', label: 'Type', type: 'select', options: ACCOUNT_TYPES },
          { key: 'currency', label: 'Currency', type: 'select', options: currencies.map((c) => ({ value: c.code, label: c.code })) },
          { key: 'description', label: 'Description (optional)' },
          { key: 'icon', label: 'Icon (emoji, optional)' },
          { key: 'active', label: 'Active', type: 'checkbox', default: true }
        ],
        initialValues: account || { type: 'asset', currency: currencies[0]?.code || '' },
        onSubmit: async (values) => {
          if (account) await FT_API.updateAccount(session(), account.id, values);
          else await FT_API.createAccount(session(), values);
          toast('Account saved');
          ROUTE_RENDERERS.accounts(content);
        }
      });
    }

    const groups = ['asset', 'expense', 'revenue', 'liability'].map((type) => ({
      label: ACCOUNT_TYPES.find((t) => t.value === type).label,
      items: accounts.filter((a) => a.active && a.type === type)
    })).filter((g) => g.items.length);
    const inactive = accounts.filter((a) => !a.active);
    if (inactive.length) groups.push({ label: 'Inactive', items: inactive });

    content.replaceChildren(
      h('div', { class: 'section' }, [
        h('div', { class: 'section-header' }, [h('h2', {}, 'Accounts'), h('button', { class: 'ft-btn ft-btn-primary', onclick: () => openAccountForm(null) }, '+ New Account')]),
        ...groups.map((g) => h('div', {}, [
          h('h4', { class: 'group-header' }, `${g.label} (${g.items.length})`),
          ...g.items.map((a) => h('div', { class: 'list-row clickable' }, [
            h('div', {}, [h('strong', {}, a.name), h('div', { class: 'muted small' }, `${a.type} · ${a.currency}`)]),
            h('div', {}, [
              h('button', { class: 'icon-btn', onclick: () => openAccountForm(a) }, '✏️'),
              h('button', { class: 'icon-btn', onclick: () => confirmDialog(`Delete "${a.name}"?`, async () => { await FT_API.deleteAccount(session(), a.id); toast('Deleted'); ROUTE_RENDERERS.accounts(content); }) }, '🗑️')
            ])
          ]))
        ])),
        !accounts.length ? h('p', { class: 'muted' }, 'No accounts yet.') : null
      ])
    );
  } catch (err) {
    content.replaceChildren(errorBox(err, () => ROUTE_RENDERERS.accounts(content)));
  }
};

// ── Transactions ──
ROUTE_RENDERERS.transactions = async function (content) {
  const filters = ROUTE_RENDERERS.transactions._filters || {};
  try {
    const [{ data: transactions }, { data: accounts }, { data: categories }, { data: tags }] = await Promise.all([
      cachedLoad(txKey(filters), () => FT_API.getTransactions(session(), filters)),
      cachedLoad('accounts', () => FT_API.getAccounts(session())),
      cachedLoad('categories', () => FT_API.getCategories(session())),
      cachedLoad('tags', () => FT_API.getTags(session()))
    ]);

    const searchText = ROUTE_RENDERERS.transactions._search || '';
    const filtered = transactions.filter((t) => !searchText || (t.description || '').toLowerCase().includes(searchText.toLowerCase()));
    const income = filtered.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = filtered.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const currency = filtered[0]?.currency || accounts[0]?.currency || 'USD';

    function openTxForm(tx) {
      const acct = accounts.find((a) => a.id === (tx ? tx.accountId : accounts[0]?.id));
      openFormModal({
        title: tx ? 'Edit Transaction' : 'New Transaction',
        fields: [
          { key: 'type', label: 'Type', type: 'select', options: [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] },
          { key: 'accountId', label: 'Account', type: 'select', options: accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })) },
          { key: 'amount', label: 'Amount', type: 'number', required: true },
          { key: 'date', label: 'Date', type: 'date', required: true },
          { key: 'description', label: 'Description' },
          { key: 'category', label: 'Category (type to add new)' },
          { key: 'tags', label: 'Tags (comma separated)' },
          { key: 'notes', label: 'Notes', type: 'textarea' }
        ],
        initialValues: tx ? { ...tx, tags: (tx.tags || []).join(', ') } : { type: 'expense', accountId: acct?.id, date: new Date().toISOString().slice(0, 10) },
        onSubmit: async (values) => {
          const body = {
            ...values,
            currency: accounts.find((a) => a.id === Number(values.accountId))?.currency || currency,
            tags: values.tags ? values.tags.split(',').map((s) => s.trim()).filter(Boolean) : []
          };
          if (tx) await FT_API.updateTransaction(session(), tx.id, body);
          else await FT_API.createTransaction(session(), body);
          toast('Transaction saved');
          ROUTE_RENDERERS.transactions(content);
        }
      });
    }

    function openCsvImport() {
      const fileInput = h('input', { type: 'file', accept: '.csv' });
      const body = h('div', { class: 'ft-modal ft-form' }, [
        h('h3', {}, 'Import CSV'),
        h('p', { class: 'muted' }, 'Columns: date, type, amount, description, category, tags, notes (tags separated by ;). All rows import into one account.'),
        h('a', { href: 'data:text/csv;charset=utf-8,date,type,amount,description,category,tags,notes\n2026-01-01,expense,12.50,Coffee,Food,,\n', download: 'fintrack-template.csv', class: 'ft-btn ft-btn-outline' }, 'Download template'),
        h('label', { class: 'ft-field-label', style: 'margin-top:12px' }, 'Import into account'),
        h('select', { id: 'csv-account', class: 'ft-input' }, accounts.map((a) => h('option', { value: a.id }, a.name))),
        h('div', { style: 'margin-top:12px' }, [fileInput]),
        h('div', { id: 'csv-error', class: 'ft-error' }),
        h('div', { class: 'ft-modal-actions' }, [
          h('button', { class: 'ft-btn ft-btn-text', onclick: () => closeModal(overlay) }, 'Cancel'),
          h('button', { class: 'ft-btn ft-btn-primary', id: 'csv-submit' }, 'Import')
        ])
      ]);
      const overlay = openModal(body);
      body.querySelector('#csv-submit').addEventListener('click', async () => {
        const errEl = body.querySelector('#csv-error');
        const file = fileInput.files[0];
        if (!file) { errEl.textContent = 'Choose a CSV file first.'; return; }
        const text = await file.text();
        const rows = parseCsv(text);
        const accountId = Number(body.querySelector('#csv-account').value);
        try {
          const result = await FT_API.importTransactions(session(), { accountId, transactions: rows });
          toast(`Imported ${result.imported ?? rows.length} row(s)` + (result.errors?.length ? `, ${result.errors.length} skipped` : ''));
          closeModal(overlay);
          ROUTE_RENDERERS.transactions(content);
        } catch (err) {
          errEl.textContent = err.message;
        }
      });
    }

    content.replaceChildren(
      h('div', { class: 'section' }, [
        h('div', { class: 'section-header' }, [
          h('h2', {}, 'Transactions'),
          h('div', {}, [
            h('button', { class: 'ft-btn ft-btn-outline', onclick: openCsvImport }, 'Import CSV'),
            h('button', { class: 'ft-btn ft-btn-primary', onclick: () => openTxForm(null) }, '+ New')
          ])
        ]),
        h('div', { class: 'filter-bar' }, [
          h('select', {
            class: 'ft-input', onchange: (e) => { ROUTE_RENDERERS.transactions._filters = { ...filters, accountId: e.target.value || undefined }; ROUTE_RENDERERS.transactions(content); }
          }, [h('option', { value: '' }, 'Account (all if empty)'), ...accounts.map((a) => h('option', { value: a.id, selected: String(filters.accountId) === String(a.id) }, a.name))]),
          h('input', {
            class: 'ft-input', placeholder: 'Search description', value: searchText,
            oninput: (e) => { ROUTE_RENDERERS.transactions._search = e.target.value; renderTxList(); }
          }),
          h('select', {
            class: 'ft-input', onchange: (e) => { ROUTE_RENDERERS.transactions._filters = { ...filters, category: e.target.value || undefined }; ROUTE_RENDERERS.transactions(content); }
          }, [h('option', { value: '' }, 'Category (all if empty)'), ...categories.map((c) => h('option', { value: c.name, selected: filters.category === c.name }, c.name))]),
          h('input', { class: 'ft-input', type: 'date', value: filters.from || '', onchange: (e) => { ROUTE_RENDERERS.transactions._filters = { ...filters, from: e.target.value || undefined }; ROUTE_RENDERERS.transactions(content); } }),
          h('input', { class: 'ft-input', type: 'date', value: filters.to || '', onchange: (e) => { ROUTE_RENDERERS.transactions._filters = { ...filters, to: e.target.value || undefined }; ROUTE_RENDERERS.transactions(content); } })
        ]),
        h('div', { class: 'stat-grid' }, [
          statCard('Income', formatMoney(income, currency), 'green'),
          statCard('Expense', formatMoney(expense, currency), 'red'),
          statCard('Difference', formatMoney(income - expense, currency), 'orange')
        ]),
        h('div', { id: 'tx-list' })
      ])
    );

    function renderTxList() {
      const listEl = document.getElementById('tx-list');
      if (!listEl) return;
      const text = (ROUTE_RENDERERS.transactions._search || '').toLowerCase();
      const rows = transactions.filter((t) => !text || (t.description || '').toLowerCase().includes(text));
      listEl.replaceChildren(...(rows.length ? rows.map((t) => h('div', { class: 'list-row' }, [
        h('div', { class: 'clickable', onclick: () => openTxForm(t) }, [
          h('div', {}, t.description || t.category || 'Untitled'),
          h('div', { class: 'muted small' }, [t.date, accounts.find((a) => a.id === t.accountId)?.name, t.category, ...(t.tags || []).map((tg) => `#${tg}`)].filter(Boolean).join(' · '))
        ]),
        h('div', {}, [
          h('span', { class: t.type === 'income' ? 'c-green' : 'c-red' }, `${t.type === 'income' ? '+' : '-'}${formatMoney(t.amount, t.currency)}`),
          h('button', { class: 'icon-btn', onclick: () => confirmDialog('Delete this transaction?', async () => { await FT_API.deleteTransaction(session(), t.id); toast('Deleted'); ROUTE_RENDERERS.transactions(content); }) }, '🗑️')
        ])
      ])) : [h('p', { class: 'muted' }, 'No transactions match.')]));
    }
    renderTxList();
  } catch (err) {
    content.replaceChildren(errorBox(err, () => ROUTE_RENDERERS.transactions(content)));
  }
};

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map((h2) => h2.trim());
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split(',');
    const row = {};
    headers.forEach((header, i) => { row[header] = (cells[i] || '').trim(); });
    return {
      date: row.date, type: row.type, amount: Number(row.amount), description: row.description,
      category: row.category, tags: row.tags ? row.tags.split(';').map((s) => s.trim()).filter(Boolean) : [], notes: row.notes
    };
  });
}

// ── Transfers ──
ROUTE_RENDERERS.transfers = async function (content) {
  try {
    const [{ data: transfers }, { data: accounts }] = await Promise.all([
      cachedLoad('transfers', () => FT_API.getTransfers(session())),
      cachedLoad('accounts', () => FT_API.getAccounts(session()))
    ]);

    function openTransferForm() {
      openFormModal({
        title: 'New Transfer',
        fields: [
          { key: 'fromAccountId', label: 'From account', type: 'select', options: accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })) },
          { key: 'toAccountId', label: 'To account', type: 'select', options: accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })) },
          { key: 'fromAmount', label: 'Amount (from account currency)', type: 'number', required: true },
          { key: 'toAmount', label: 'Amount received (to account currency)', type: 'number' },
          { key: 'date', label: 'Date', type: 'date', required: true },
          { key: 'description', label: 'Description' }
        ],
        initialValues: { fromAccountId: accounts[0]?.id, toAccountId: accounts[1]?.id, date: new Date().toISOString().slice(0, 10) },
        onSubmit: async (values) => {
          const fromAcct = accounts.find((a) => a.id === Number(values.fromAccountId));
          const toAcct = accounts.find((a) => a.id === Number(values.toAccountId));
          const toAmount = values.toAmount || values.fromAmount;
          await FT_API.createTransfer(session(), {
            fromAccountId: Number(values.fromAccountId), toAccountId: Number(values.toAccountId),
            fromAmount: values.fromAmount, toAmount, fromCurrency: fromAcct.currency, toCurrency: toAcct.currency,
            conversionRate: values.fromAmount ? toAmount / values.fromAmount : 1,
            description: values.description, date: values.date
          });
          toast('Transfer created');
          ROUTE_RENDERERS.transfers(content);
        }
      });
    }

    content.replaceChildren(
      h('div', { class: 'section' }, [
        h('div', { class: 'section-header' }, [h('h2', {}, 'Transfers'), h('button', { class: 'ft-btn ft-btn-primary', onclick: openTransferForm }, '+ New Transfer')]),
        ...(transfers.length ? transfers.map((t) => {
          const from = accounts.find((a) => a.id === t.fromAccountId);
          const to = accounts.find((a) => a.id === t.toAccountId);
          return h('div', { class: 'list-row' }, [
            h('div', {}, [h('strong', {}, `${from?.name || '?'} → ${to?.name || '?'}`), h('div', { class: 'muted small' }, t.date)]),
            h('div', {}, [
              h('span', {}, `${formatMoney(t.fromAmount, t.fromCurrency)} → ${formatMoney(t.toAmount, t.toCurrency)}`),
              h('button', { class: 'icon-btn', onclick: () => confirmDialog('Delete this transfer?', async () => { await FT_API.deleteTransfer(session(), t.id); toast('Deleted'); ROUTE_RENDERERS.transfers(content); }) }, '🗑️')
            ])
          ]);
        }) : [h('p', { class: 'muted' }, 'No transfers yet.')])
      ])
    );
  } catch (err) {
    content.replaceChildren(errorBox(err, () => ROUTE_RENDERERS.transfers(content)));
  }
};

// ── Recurring ──
const FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'].map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }));

ROUTE_RENDERERS.recurring = async function (content) {
  try {
    const [{ data: rules }, { data: accounts }] = await Promise.all([
      cachedLoad('recurring', () => FT_API.getRecurring(session())),
      cachedLoad('accounts', () => FT_API.getAccounts(session()))
    ]);

    function openForm(rule) {
      openFormModal({
        title: rule ? 'Edit Recurring Rule' : 'New Recurring Rule',
        fields: [
          { key: 'name', label: 'Name', required: true },
          { key: 'type', label: 'Type', type: 'select', options: [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] },
          { key: 'accountId', label: 'Account', type: 'select', options: accounts.map((a) => ({ value: a.id, label: a.name })) },
          { key: 'amount', label: 'Amount', type: 'number', required: true },
          { key: 'frequency', label: 'Frequency', type: 'select', options: FREQUENCIES },
          { key: 'nextDate', label: 'Next date', type: 'date', required: true },
          { key: 'category', label: 'Category' },
          { key: 'description', label: 'Description' },
          { key: 'active', label: 'Active', type: 'checkbox', default: true }
        ],
        initialValues: rule || { type: 'expense', accountId: accounts[0]?.id, frequency: 'monthly', nextDate: new Date().toISOString().slice(0, 10) },
        onSubmit: async (values) => {
          const body = { ...values, currency: accounts.find((a) => a.id === Number(values.accountId))?.currency };
          if (rule) await FT_API.updateRecurring(session(), rule.id, body);
          else await FT_API.createRecurring(session(), body);
          toast('Recurring rule saved');
          ROUTE_RENDERERS.recurring(content);
        }
      });
    }

    content.replaceChildren(
      h('div', { class: 'section' }, [
        h('div', { class: 'section-header' }, [h('h2', {}, 'Recurring'), h('button', { class: 'ft-btn ft-btn-primary', onclick: () => openForm(null) }, '+ New')]),
        ...(rules.length ? rules.map((r) => h('div', { class: 'list-row' }, [
          h('div', { class: 'clickable', onclick: () => openForm(r) }, [
            h('strong', {}, r.name),
            h('div', { class: 'muted small' }, `${r.frequency} · next ${r.nextDate} · ${formatMoney(r.amount, r.currency)}${r.active ? '' : ' · inactive'}`)
          ]),
          h('div', {}, [
            h('button', { class: 'ft-btn ft-btn-outline', onclick: async () => { await FT_API.postRecurring(session(), r.id); toast('Posted'); ROUTE_RENDERERS.recurring(content); } }, 'Post'),
            h('button', { class: 'icon-btn', onclick: () => confirmDialog(`Delete "${r.name}"?`, async () => { await FT_API.deleteRecurring(session(), r.id); toast('Deleted'); ROUTE_RENDERERS.recurring(content); }) }, '🗑️')
          ])
        ])) : [h('p', { class: 'muted' }, 'No recurring rules yet.')])
      ])
    );
  } catch (err) {
    content.replaceChildren(errorBox(err, () => ROUTE_RENDERERS.recurring(content)));
  }
};

// ── Budgets ──
ROUTE_RENDERERS.budgets = async function (content) {
  try {
    const [{ data: budgets }, { data: categories }, { data: currencies }] = await Promise.all([
      cachedLoad('budgets', () => FT_API.getBudgets(session())),
      cachedLoad('categories', () => FT_API.getCategories(session())),
      cachedLoad('currencies', () => FT_API.getCurrencies(session()))
    ]);

    function openForm(budget) {
      openFormModal({
        title: budget ? 'Edit Budget' : 'New Budget',
        fields: [
          { key: 'name', label: 'Name', required: true },
          { key: 'category', label: 'Category', type: 'select', options: [{ value: '', label: 'All categories' }, ...categories.map((c) => ({ value: c.name, label: c.name }))] },
          { key: 'limitAmt', label: 'Limit amount', type: 'number', required: true },
          { key: 'currency', label: 'Currency', type: 'select', options: currencies.map((c) => ({ value: c.code, label: c.code })) },
          { key: 'period', label: 'Period', type: 'select', options: [{ value: 'monthly', label: 'Monthly' }, { value: 'weekly', label: 'Weekly' }, { value: 'yearly', label: 'Yearly' }] },
          { key: 'startDate', label: 'Start date', type: 'date' },
          { key: 'active', label: 'Active', type: 'checkbox', default: true }
        ],
        initialValues: budget || { period: 'monthly', currency: currencies[0]?.code, startDate: new Date().toISOString().slice(0, 10) },
        onSubmit: async (values) => {
          if (budget) await FT_API.updateBudget(session(), budget.id, values);
          else await FT_API.createBudget(session(), values);
          toast('Budget saved');
          ROUTE_RENDERERS.budgets(content);
        }
      });
    }

    content.replaceChildren(
      h('div', { class: 'section' }, [
        h('div', { class: 'section-header' }, [h('h2', {}, 'Budgets'), h('button', { class: 'ft-btn ft-btn-primary', onclick: () => openForm(null) }, '+ New Budget')]),
        ...(budgets.length ? budgets.map((b) => h('div', { class: 'list-row' }, [
          h('div', { class: 'clickable', onclick: () => openForm(b) }, [
            h('strong', {}, b.name),
            h('div', { class: 'muted small' }, `${b.category || 'All categories'} · ${formatMoney(b.limitAmt, b.currency)} / ${b.period}${b.active ? '' : ' · inactive'}`)
          ]),
          h('button', { class: 'icon-btn', onclick: () => confirmDialog(`Delete "${b.name}"?`, async () => { await FT_API.deleteBudget(session(), b.id); toast('Deleted'); ROUTE_RENDERERS.budgets(content); }) }, '🗑️')
        ])) : [h('p', { class: 'muted' }, 'No budgets yet.')])
      ])
    );
  } catch (err) {
    content.replaceChildren(errorBox(err, () => ROUTE_RENDERERS.budgets(content)));
  }
};

// ── Categories & Tags ──
ROUTE_RENDERERS.categories = async function (content) {
  try {
    const [{ data: categories }, { data: tags }] = await Promise.all([
      cachedLoad('categories', () => FT_API.getCategories(session())),
      cachedLoad('tags', () => FT_API.getTags(session()))
    ]);

    function openCategoryForm(cat) {
      openFormModal({
        title: cat ? 'Edit Category' : 'New Category',
        fields: [
          { key: 'name', label: 'Name', required: true },
          { key: 'type', label: 'Type', type: 'select', options: [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'transfer', label: 'Transfer' }] },
          { key: 'icon', label: 'Icon (emoji, optional)' }
        ],
        initialValues: cat || { type: 'expense' },
        onSubmit: async (values) => {
          if (cat) await FT_API.updateCategory(session(), cat.id, values);
          else await FT_API.createCategory(session(), values);
          toast('Category saved');
          ROUTE_RENDERERS.categories(content);
        }
      });
    }

    let newTag = '';
    content.replaceChildren(
      h('div', { class: 'section' }, [
        h('div', { class: 'section-header' }, [h('h2', {}, 'Categories'), h('button', { class: 'ft-btn ft-btn-primary', onclick: () => openCategoryForm(null) }, '+ New Category')]),
        ...(categories.length ? categories.map((c) => h('div', { class: 'list-row clickable' }, [
          h('div', { onclick: () => openCategoryForm(c) }, [h('strong', {}, `${c.icon || ''} ${c.name}`), h('div', { class: 'muted small' }, c.type)]),
          h('button', { class: 'icon-btn', onclick: () => confirmDialog(`Delete "${c.name}"?`, async () => { await FT_API.deleteCategory(session(), c.id); toast('Deleted'); ROUTE_RENDERERS.categories(content); }) }, '🗑️')
        ])) : [h('p', { class: 'muted' }, 'No categories yet.')]),

        h('h2', { style: 'margin-top:32px' }, 'Tags'),
        h('div', { id: 'tags-chip-list', class: 'chip-row' }, tags.map((t) => tagChip(t, tags, content))),
        h('div', { class: 'filter-bar' }, [
          h('input', { id: 'new-tag-input', class: 'ft-input', placeholder: 'Add a tag' }),
          h('button', {
            class: 'ft-btn ft-btn-outline', onclick: async () => {
              const input = document.getElementById('new-tag-input');
              const value = input.value.trim();
              if (!value) return;
              const updated = [...new Set([...tags, value])];
              await FT_API.saveTags(session(), updated);
              toast('Tag added');
              ROUTE_RENDERERS.categories(content);
            }
          }, 'Add tag')
        ])
      ])
    );
  } catch (err) {
    content.replaceChildren(errorBox(err, () => ROUTE_RENDERERS.categories(content)));
  }
};

function tagChip(tag, allTags, content) {
  return h('span', { class: 'chip' }, [
    `#${tag}`,
    h('button', {
      class: 'chip-remove', onclick: async () => {
        await FT_API.saveTags(session(), allTags.filter((t) => t !== tag));
        toast('Tag removed');
        ROUTE_RENDERERS.categories(content);
      }
    }, '×')
  ]);
}

// ── Currencies ──
ROUTE_RENDERERS.currencies = async function (content) {
  try {
    const { data: currencies } = await cachedLoad('currencies', () => FT_API.getCurrencies(session()));

    function openForm(currency) {
      openFormModal({
        title: currency ? 'Edit Currency' : 'New Currency',
        fields: [
          { key: 'code', label: 'Code (e.g. USD)', required: true },
          { key: 'name', label: 'Display name', required: true },
          { key: 'symbol', label: 'Symbol' },
          { key: 'rate', label: 'Conversion rate (relative to base currency)', type: 'number', required: true, default: 1 }
        ],
        initialValues: currency || { rate: 1 },
        onSubmit: async (values) => {
          if (currency) await FT_API.updateCurrency(session(), currency.id, values);
          else await FT_API.createCurrency(session(), values);
          toast('Currency saved');
          ROUTE_RENDERERS.currencies(content);
        }
      });
    }

    content.replaceChildren(
      h('div', { class: 'section' }, [
        h('div', { class: 'section-header' }, [h('h2', {}, 'Currencies'), h('button', { class: 'ft-btn ft-btn-primary', onclick: () => openForm(null) }, '+ New Currency')]),
        h('p', { class: 'muted' }, 'Rates are entered manually — FinTrack does not fetch live exchange rates.'),
        ...(currencies.length ? currencies.map((c) => h('div', { class: 'list-row clickable' }, [
          h('div', { onclick: () => openForm(c) }, [h('strong', {}, `${c.code} — ${c.name}`), h('div', { class: 'muted small' }, `${c.symbol || ''} · rate ${c.rate}`)]),
          h('button', { class: 'icon-btn', onclick: () => confirmDialog(`Delete "${c.code}"?`, async () => { await FT_API.deleteCurrency(session(), c.id); toast('Deleted'); ROUTE_RENDERERS.currencies(content); }) }, '🗑️')
        ])) : [h('p', { class: 'muted' }, 'No currencies yet.')])
      ])
    );
  } catch (err) {
    content.replaceChildren(errorBox(err, () => ROUTE_RENDERERS.currencies(content)));
  }
};

// ── Settings ──
ROUTE_RENDERERS.settings = async function (content) {
  try {
    const { data: settings } = await cachedLoad('settings', () => FT_API.getSettings(session()));
    const identity = await FT_PIN.getIdentity(FT_APP.currentIdentityId);

    content.replaceChildren(
      h('div', { class: 'section' }, [
        h('h2', {}, 'Settings'),

        h('div', { class: 'card' }, [
          h('h4', {}, 'Base Currency'),
          h('input', { id: 'base-currency-input', class: 'ft-input', value: settings.base_currency || settings.baseCurrency || 'USD' }),
          h('button', {
            class: 'ft-btn ft-btn-primary', style: 'margin-top:8px', onclick: async () => {
              await FT_API.saveSettings(session(), { base_currency: document.getElementById('base-currency-input').value });
              toast('Saved');
            }
          }, 'Save')
        ]),

        h('div', { class: 'card' }, [
          h('h4', {}, 'PIN Lock'),
          identity.pinEnabled
            ? h('div', {}, [
                h('p', { class: 'muted' }, `Enabled — asks for your PIN every time you open FinTrack, and again after ${FT_PIN.timeoutMinutes(identity)} minutes in the background.`),
                h('button', { class: 'ft-btn ft-btn-outline', onclick: () => openPinChangeForm(identity, content) }, 'Change PIN'),
                h('button', { class: 'ft-btn ft-btn-outline', onclick: () => openPinDisableForm(identity, content) }, 'Disable')
              ])
            : h('div', {}, [
                h('p', { class: 'muted' }, 'Not enabled (unusual — normally required on first login).'),
                h('button', { class: 'ft-btn ft-btn-primary', onclick: () => renderPinSetup(identity, true) }, 'Enable PIN Lock')
              ])
        ]),

        h('div', { class: 'card' }, [
          h('h4', {}, 'This Device'),
          h('p', { class: 'muted' }, `${identity.loginName} @ ${identity.serverUrl}`),
          h('button', {
            class: 'ft-btn ft-btn-outline', onclick: async () => {
              // Clear only the cache store, keep credentials/PIN — useful if cached data looks stale/wrong.
              const dbName = `fintrack_data_${identity.id}`;
              const req = indexedDB.open(dbName);
              req.onsuccess = () => {
                const tx = req.result.transaction('cache', 'readwrite');
                tx.objectStore('cache').clear();
                tx.oncomplete = () => toast('Local cache cleared');
              };
            }
          }, 'Clear Local Cache')
        ])
      ])
    );
  } catch (err) {
    content.replaceChildren(errorBox(err, () => ROUTE_RENDERERS.settings(content)));
  }
};

function openPinChangeForm(identity, content) {
  openFormModal({
    title: 'Change PIN',
    fields: [
      { key: 'pin1', label: 'New PIN (4–6 digits)', type: 'password' },
      { key: 'pin2', label: 'Confirm PIN', type: 'password' },
      { key: 'timeoutMinutes', label: 'Re-lock after (minutes)', type: 'select', options: [{ value: 0, label: 'Immediately' }, { value: 1, label: '1 minute' }, { value: 5, label: '5 minutes' }, { value: 15, label: '15 minutes' }, { value: 30, label: '30 minutes' }], default: FT_PIN.timeoutMinutes(identity) }
    ],
    onSubmit: async (values) => {
      if (!/^\d{4,6}$/.test(values.pin1) || values.pin1 !== values.pin2) throw new Error("PINs must match and be 4–6 digits.");
      const oldKey = FT_PIN.currentKey(identity.id);
      const session_ = await FT_DB.getDecrypted(identity.id, 'secure', 'session', oldKey);
      const pinFields = await FT_PIN.buildPinFields(values.pin1, Number(values.timeoutMinutes));
      const updated = { ...identity, ...pinFields };
      await FT_DB.saveIdentity(updated);
      await FT_PIN.unlockWithNewPin(identity.id, values.pin1, pinFields.encSalt);
      if (session_) await FT_DB.putEncrypted(identity.id, 'secure', 'session', FT_PIN.currentKey(identity.id), session_);
      toast('PIN updated');
      ROUTE_RENDERERS.settings(content);
    }
  });
}

function openPinDisableForm(identity, content) {
  openFormModal({
    title: 'Disable PIN Lock',
    fields: [{ key: 'pin', label: 'Current PIN', type: 'password', required: true }],
    onSubmit: async (values) => {
      const ok = await FT_PIN.verifyAndUnlock(identity.id, values.pin);
      if (!ok) throw new Error('Incorrect PIN.');
      await FT_DB.saveIdentity({ ...identity, pinEnabled: false });
      toast('PIN Lock disabled — local data is no longer encrypted with a PIN-derived key.');
      ROUTE_RENDERERS.settings(content);
    }
  });
}

// ── External API ──
ROUTE_RENDERERS.external = async function (content) {
  try {
    const { data: tokenData } = await cachedLoad('token', () => FT_API.getToken(session()));
    const token = tokenData.token || tokenData.apiToken;
    const quickAddExample = FT_API.quickAddUrl(session().serverUrl, token, { amount: '12.50', type: 'expense', account: '1', category: 'Coffee', description: 'Latte' });

    content.replaceChildren(
      h('div', { class: 'section' }, [
        h('h2', {}, 'External API'),
        h('p', { class: 'muted' }, 'A token-authenticated way to log transactions without a Nextcloud login — e.g. from a phone shortcut or bookmarklet.'),
        h('div', { class: 'card' }, [
          h('h4', {}, 'Your API Token'),
          h('code', { class: 'token-box' }, token),
          h('button', { class: 'ft-btn ft-btn-outline', onclick: () => navigator.clipboard.writeText(token).then(() => toast('Token copied')) }, 'Copy token'),
          h('button', {
            class: 'ft-btn ft-btn-outline', onclick: () => confirmDialog('Regenerate your API token? This immediately invalidates the old one everywhere it\'s used.', async () => {
              await FT_API.regenerateToken(session());
              toast('Token regenerated');
              ROUTE_RENDERERS.external(content);
            })
          }, 'Regenerate token')
        ]),
        h('div', { class: 'card' }, [
          h('h4', {}, 'Quick Add URL (example)'),
          h('p', { class: 'muted small' }, 'Bookmark a URL like this (with your own amount/account/category) for one-tap logging.'),
          h('code', { class: 'token-box' }, quickAddExample),
          h('button', { class: 'ft-btn ft-btn-outline', onclick: () => navigator.clipboard.writeText(quickAddExample).then(() => toast('URL copied')) }, 'Copy URL')
        ])
      ])
    );
  } catch (err) {
    content.replaceChildren(errorBox(err, () => ROUTE_RENDERERS.external(content)));
  }
};
