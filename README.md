# FinTrack PWA

An installable Progressive Web App for [FinTrack](https://github.com/cloudsliberty/fintrack) —
the same Nextcloud REST API the Android app uses, with a fuller feature set (this covers every
endpoint in the FinTrack manual; the Android app intentionally only exposes the basics).

## ⚠️ Before you deploy this: CORS

This is a static, standalone web app — it is **not** served from inside your Nextcloud instance.
That means every API call it makes is a genuine cross-origin request, and **Nextcloud does not
send permissive CORS headers by default**. Without one of the following, login will work (Login
Flow v2's `/index.php/login/v2` endpoints are commonly reachable) but subsequent API calls to
`/index.php/apps/fintrack/api/...` will likely be blocked by the browser:

- **Best option:** host this PWA's files on the *same origin* as your Nextcloud instance (e.g. a
  static path served by the same reverse proxy/web server, such as
  `https://cloud.example.com/fintrack-pwa/`). No CORS needed at all.
- **Alternative:** add CORS response headers (`Access-Control-Allow-Origin`,
  `Access-Control-Allow-Headers: Authorization, Content-Type`,
  `Access-Control-Allow-Methods: GET, POST, PUT, DELETE`) for this PWA's specific origin on the
  web server in front of Nextcloud (e.g. an Apache/Nginx config block scoped to the
  `/index.php/apps/fintrack/` and `/index.php/login/` paths). Don't blanket-allow `*` — scope it
  to your PWA's exact origin.

## Running it

No build step — it's plain HTML/CSS/JS. Serve the folder with any static file server (it must be
served over HTTP(S), not opened as a `file://` URL, or Service Workers and IndexedDB won't work
correctly), e.g.:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open it in a browser and use the install prompt (or your browser's "Install app" /
"Add to Home Screen" option) to install it.

## Authentication

Uses Nextcloud's official **Login Flow v2** — the exact same protocol the Android app uses, not a
custom shortcut:

1. `POST /index.php/login/v2` — no credentials sent, returns a `login` URL and a `poll` token/endpoint.
2. The `login` URL opens in a new tab where the person authenticates directly with Nextcloud (the
   PWA never sees their Nextcloud password).
3. The PWA polls `poll.endpoint` every 2 seconds; once the person approves, it receives a
   Nextcloud **app password** (not their real password) plus their login name.
4. Every subsequent API call uses HTTP Basic Auth with `loginName:appPassword` — identical to how
   the Android app and Nextcloud's own official clients authenticate.

The app password can be revoked at any time from Nextcloud's own **Settings → Security** page
without affecting the person's main account password.

## Security model — what's actually protected, and what isn't

- **Per-user isolation.** Every Nextcloud identity (server + login name) that has ever signed in
  on this device gets its own IndexedDB database (`fintrack_data_<hash>`), so multiple people
  using FinTrack in the same browser profile never share storage.
- **Encryption at rest.** Every value written to IndexedDB — the app password, cached
  accounts/transactions/etc, settings — is AES-256-GCM encrypted. The key is derived via PBKDF2
  (210,000 rounds, SHA-256) from the local PIN set up on first login. The PIN itself is never
  stored — only a separately-salted PBKDF2 verifier, which can check a guess but can't be used to
  derive the encryption key.
- **PIN Lock behavior mirrors the Android app:** always required on a fresh page load; a
  configurable timeout (Settings → PIN Lock) controls how long the tab can be hidden/backgrounded
  before it re-locks; changing/disabling the PIN requires the current PIN.
- **The service worker never caches API responses** — only the static app shell (HTML/CSS/JS/
  icons), specifically so no financial data ever lands in the browser's unencrypted Cache Storage.
  All actual data caching goes through the encrypted IndexedDB layer above.

**Honest limitation:** this is client-side JavaScript in a shared browser. Anyone who can execute
arbitrary code in this page's origin — a malicious browser extension, a compromised browser, or
physical access to an *already-unlocked* session — can, in principle, intercept the PIN as it's
typed or the derived key while unlocked. What this setup *does* reliably stop: casual inspection
of browser storage by someone else with access to the same machine/profile who doesn't know the
PIN (they get ciphertext, not your balances), and any data bleed between different people's
FinTrack logins in the same browser. It is not a substitute for full-disk encryption or a
dedicated, trusted device — for genuinely sensitive use, the native Android app's OS-backed
`EncryptedSharedPreferences` + optional biometric unlock is the stronger option.

## Install prompt

On supported browsers (Chromium-based; Firefox/Safari handle "add to home screen" differently and
won't fire this prompt), the app listens for `beforeinstallprompt` and shows a **Yes / Later / No**
dialog:

- **Yes** — triggers the native browser install prompt immediately.
- **Later** — dismisses for 3 days, then asks again.
- **No** — dismissed permanently (stored in `localStorage`, per-browser-profile).

## Feature coverage (vs. the Android app)

Everything the Android app has, plus (per the manual's full "Internal REST API" and
"Public/External API" sections) the options the Android app intentionally leaves out:

- **CSV bulk import** for transactions, with a downloadable template.
- **Currencies CRUD** (code, name, symbol, manual conversion rate) — Android only lets you *pick*
  an existing currency when creating an account.
- **External API / Quick Add token management** — view/copy/regenerate your personal API token,
  and a ready-to-copy Quick Add URL for bookmarklets/shortcuts. Not present in the Android app at
  all.
- **Full Tags management** (add/remove global tags), not just per-transaction tagging.
- **Recurring "Post now"** action, same as Android.
- Every entity (Accounts, Transactions, Transfers, Budgets, Categories, Currencies, Recurring)
  supports full CRUD with every field the API accepts.

## File structure

```
pwa/
├── index.html
├── manifest.json
├── service-worker.js
├── css/style.css
├── js/
│   ├── crypto.js     — Web Crypto (PBKDF2 + AES-GCM) helpers
│   ├── db.js          — IndexedDB layer (device DB + per-identity encrypted DBs)
│   ├── pin.js          — PIN lock logic (mirrors the Android app's settings-driven behavior)
│   ├── api.js          — FinTrack REST API client + Nextcloud Login Flow v2
│   ├── app.js           — bootstrap, auth screens, router shell, generic form builder
│   └── sections.js      — every entity's view (Dashboard, Transactions, Accounts, ...)
└── icons/               — app icons (same "FT on blue" branding as the Android app)
```
