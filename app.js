import { SecureUserStore } from './crypto-store.js';
import { FinTrackAPIClient } from './api.js';

let deferredPrompt = null;
const secureStore = new SecureUserStore();
const api = new FinTrackAPIClient();

// Service Worker Registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

// Installation Banner Handling
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;

  const choice = localStorage.getItem('pwa_install_choice');
  if (choice !== 'no' && choice !== 'later_dismissed') {
    document.getElementById('pwaInstallPrompt').classList.remove('hidden');
  }
});

document.getElementById('btnInstallYes').addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      localStorage.setItem('pwa_install_choice', 'installed');
    }
    deferredPrompt = null;
  }
  document.getElementById('pwaInstallPrompt').classList.add('hidden');
});

document.getElementById('btnInstallLater').addEventListener('click', () => {
  localStorage.setItem('pwa_install_choice', 'later_dismissed');
  document.getElementById('pwaInstallPrompt').classList.add('hidden');
});

document.getElementById('btnInstallNo').addEventListener('click', () => {
  localStorage.setItem('pwa_install_choice', 'no');
  document.getElementById('pwaInstallPrompt').classList.add('hidden');
});

// App Entrypoint & Security Lifecycle
async function initApp() {
  await secureStore.init();
  const activeUser = localStorage.getItem('active_user_id');
  const isPinEnabled = localStorage.getItem('pin_enabled') === 'true';

  if (isPinEnabled && activeUser) {
    document.getElementById('pinModal').classList.remove('hidden');
    document.getElementById('pinUnlockBtn').onclick = async () => {
      const pin = document.getElementById('pinInput').value;
      const data = await secureStore.getDecryptedData(activeUser, pin, 'user_session');
      if (data) {
        api.setToken(data.token);
        document.getElementById('pinModal').classList.add('hidden');
        renderDashboard();
      } else {
        alert('Invalid PIN');
      }
    };
  } else {
    renderLogin();
  }
}

function renderLogin() {
  const container = document.getElementById('mainContent');
  container.innerHTML = `
    <div class="login-box">
      <h2>Login</h2>
      <input type="text" id="username" placeholder="Username" />
      <input type="password" id="password" placeholder="Password" />
      <input type="password" id="pin" placeholder="Set App PIN (Optional)" />
      <button id="loginBtn">Sign In</button>
    </div>
  `;

  document.getElementById('loginBtn').onclick = async () => {
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    const pin = document.getElementById('pin').value;

    try {
      const res = await api.login(u, p);
      if (res.token) {
        api.setToken(res.token);
        localStorage.setItem('active_user_id', u);
        
        if (pin) {
          localStorage.setItem('pin_enabled', 'true');
          await secureStore.saveEncryptedData(u, pin, 'user_session', { token: res.token, user: u });
        }
        renderDashboard();
      }
    } catch (err) {
      alert('Login Failed: ' + err.message);
    }
  };
}

async function renderDashboard() {
  const container = document.getElementById('mainContent');
  container.innerHTML = '<h2>Loading...</h2>';
  try {
    const dashboard = await api.getDashboard();
    container.innerHTML = `
      <h2>Dashboard Summary</h2>
      <div class="card">Total Balance: ${dashboard.total_balance ?? 0}</div>
      <h3>Recent Transactions</h3>
      <ul id="txList"></ul>
    `;
    const txs = await api.getTransactions({ limit: 10 });
    const txList = document.getElementById('txList');
    txs.forEach(tx => {
      const li = document.createElement('li');
      li.textContent = `${tx.date} - ${tx.description || 'Transaction'}: $${tx.amount}`;
      txList.appendChild(li);
    });
  } catch (err) {
    container.innerHTML = `<p class="error">Error loading dashboard: ${err.message}</p>`;
  }
}

initApp();
// Register SW with relative path
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}
function renderLogin() {
  const container = document.getElementById('mainContent');
  container.innerHTML = `
    <form class="login-box" onsubmit="return false;">
      <h2>Login</h2>
      <input type="text" id="username" placeholder="Username" autocomplete="username" />
      <input type="password" id="password" placeholder="Password" autocomplete="current-password" />
      <input type="password" id="pin" placeholder="Set App PIN (Optional)" autocomplete="new-password" />
      <button type="submit" id="loginBtn">Sign In</button>
    </form>
  `;
  // ... rest of your code
}
