import { SecureUserStore } from './crypto-store.js';
import { FinTrackAPIClient } from './api.js';

const secureStore = new SecureUserStore();
const api = new FinTrackAPIClient();

async function initApp() {
  await secureStore.init();
  const activeUser = localStorage.getItem('active_user_id');
  const isPinEnabled = localStorage.getItem('pin_enabled') === 'true';

  // Resume active polling session if user was redirected back from Nextcloud
  const pendingPoll = localStorage.getItem('nc_poll_info');
  if (pendingPoll) {
    await resumeLoginFlow(JSON.parse(pendingPoll));
    return;
  }

  if (isPinEnabled && activeUser) {
    document.getElementById('pinModal').classList.remove('hidden');
    document.getElementById('pinForm').onsubmit = async (e) => {
      e.preventDefault();
      const pin = document.getElementById('pinInput').value;
      const session = await secureStore.getDecryptedData(activeUser, pin, 'user_session');
      if (session && session.username && session.appPassword && session.serverUrl) {
        api.setBaseUrl(session.serverUrl);
        api.setCredentials(session.username, session.appPassword);
        document.getElementById('userPill').textContent = `User: ${activeUser}`;
        document.getElementById('pinModal').classList.add('hidden');
        renderDashboard();
      } else {
        alert('Invalid PIN.');
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
    <div class="login-box">
      <h2>Connect to Nextcloud</h2>
      <p>You will be redirected to your Nextcloud instance to sign in and grant access.</p>
      <input type="url" id="serverUrl" placeholder="https://cloud.example.com" value="${savedServer}" required />
      <input type="password" id="pin" placeholder="Set App Lock PIN (Optional)" autocomplete="new-password" />
      <button type="button" id="startLoginBtn">Authorize with Nextcloud</button>
    </div>
  `;

  document.getElementById('startLoginBtn').onclick = async () => {
    const serverUrl = document.getElementById('serverUrl').value.trim();
    const pin = document.getElementById('pin').value;

    if (!serverUrl) {
      alert('Please enter your Nextcloud server URL.');
      return;
    }

    try {
      // Step 1: Initialize Login Flow v2
      const flowData = await api.initLoginFlowV2(serverUrl);

      // Save poll metadata locally before redirecting
      const pollInfo = {
        serverUrl,
        pin,
        token: flowData.poll.token,
        endpoint: flowData.poll.endpoint
      };
      localStorage.setItem('nc_poll_info', JSON.stringify(pollInfo));
      localStorage.setItem('last_server_url', serverUrl);

      // Step 2: Open login flow URL in a new tab or redirect
      window.open(flowData.login, '_blank');

      // Step 3: Start polling for approval
      await resumeLoginFlow(pollInfo);
    } catch (err) {
      alert('Error initializing login flow: ' + err.message);
    }
  };
}

async function resumeLoginFlow(pollInfo) {
  const container = document.getElementById('mainContent');
  container.innerHTML = `
    <div class="login-box">
      <h2>Waiting for Nextcloud Authorization...</h2>
      <p>Please complete the login in the opened Nextcloud window.</p>
      <div class="spinner"></div>
      <button id="cancelAuthBtn">Cancel</button>
    </div>
  `;

  let isPolling = true;
  document.getElementById('cancelAuthBtn').onclick = () => {
    isPolling = false;
    localStorage.removeItem('nc_poll_info');
    renderLogin();
  };

  // Poll loop (attempts every 2 seconds for up to 20 minutes)
  while (isPolling) {
    try {
      const result = await api.pollLoginFlowV2(pollInfo.endpoint, pollInfo.token);
      
      if (result && result.appPassword) {
        localStorage.removeItem('nc_poll_info');
        
        const username = result.loginName;
        const appPassword = result.appPassword;

        api.setBaseUrl(pollInfo.serverUrl);
        api.setCredentials(username, appPassword);

        localStorage.setItem('active_user_id', username);
        document.getElementById('userPill').textContent = `User: ${username}`;

        if (pollInfo.pin) {
          localStorage.setItem('pin_enabled', 'true');
          await secureStore.saveEncryptedData(username, pollInfo.pin, 'user_session', {
            username,
            appPassword,
            serverUrl: pollInfo.serverUrl
          });
        }

        renderDashboard();
        break;
      }
    } catch (err) {
      alert('Authorization failed or timed out: ' + err.message);
      localStorage.removeItem('nc_poll_info');
      renderLogin();
      break;
    }

    // Wait 2 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

async function renderDashboard() {
  const container = document.getElementById('mainContent');
  container.innerHTML = '<h2>Loading Dashboard...</h2>';
  try {
    const dashboard = await api.getDashboard();
    container.innerHTML = `
      <h2>Dashboard Summary</h2>
      <div class="card">Total Balance: ${dashboard.total_balance ?? 0}</div>
      <button id="logoutBtn" style="margin-top:20px;">Log Out</button>
    `;

    document.getElementById('logoutBtn').onclick = () => {
      localStorage.clear();
      location.reload();
    };
  } catch (err) {
    container.innerHTML = `<p class="error">Error: ${err.message}</p>`;
  }
}

initApp();
