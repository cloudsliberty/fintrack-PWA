import { SecureUserStore } from './crypto-store.js';
import { FinTrackAPIClient } from './api.js';

let deferredPrompt = null;
const secureStore = new SecureUserStore();
const api = new FinTrackAPIClient();

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => {
    console.error('Service Worker registration failed:', err);
  });
}

// PWA Install Banner Logic
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

// App Initialization
async function initApp() {
  await secureStore.init();
  const activeUser = localStorage.getItem('active_user_id');
  const isPinEnabled = localStorage.getItem('pin_enabled') === 'true';

  if (isPinEnabled && activeUser) {
    document.getElementById('pinModal').classList.remove('hidden');
    
    document.getElementById('pinForm').onsubmit = async (e) => {
      e.preventDefault();
      const pin = document.getElementById('pinInput').value;
      const session = await secureStore.getDecryptedData(activeUser, pin, 'user_session');
      if (session && session.token && session.serverUrl) {
        api.setBaseUrl(session.serverUrl);
        api.setToken(session.token);
        document.getElementById('userPill').textContent = `User: ${activeUser}`;
        document.getElementById('pinModal').classList.add('hidden');
        renderDashboard();
      } else {
        alert('Invalid PIN or expired session.');
      }
    };
  } else {
    renderLogin();
  }
}

function renderLogin() {
  const container = document.getElementById('mainContent');
  const savedServer = localStorage.getItem('last_server_url') || '';

  container.innerHTML = `
    <form id="loginForm" class="login-box" onsubmit="return false;">
      <h2>Connect to Nextcloud</h2>
      <input type="url" id="serverUrl" placeholder="https://nextcloud.example.com" value="${savedServer}" required />
      <input type="text" id="username" placeholder="Username" autocomplete="username" required />
      <input type="password" id="password" placeholder="Password" autocomplete="current-password" required />
      <input type="password" id="pin" placeholder="Set App Lock PIN (Optional)" autocomplete="new-password" />
      <button type="submit" id="loginBtn">Sign In</button>
    </form>
  `;

  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const serverUrl = document.getElementById('serverUrl').value.trim();
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value;
    const pin = document.getElementById('pin').value;

    try {
      const res = await api.login(serverUrl, u, p);
      if (res.token) {
        api.setToken(res.token);
        localStorage.setItem('active_user_id', u);
        localStorage.setItem('last_server_url', serverUrl);
        document.getElementById('userPill').textContent = `User: ${u}`;
        
        if (pin) {
          localStorage.setItem('pin_enabled', 'true');
          await secureStore.saveEncryptedData(u, pin, 'user_session', { 
            token: res.token, 
            user: u, 
            serverUrl 
          });
        }
        renderDashboard();
      }
    } catch (err) {
      alert('Connection Failed: ' + err.message);
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
