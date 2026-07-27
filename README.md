# FinTrack PWA

An installable Progressive Web App for [FinTrack](https://github.com/cloudsliberty/fintrack) —
the same Nextcloud REST API the Android app uses, with a fuller feature set (this covers every
endpoint in the FinTrack manual; the Android app intentionally only exposes the basics).

## ⚠️ Before you deploy this: CORS

This is a static, standalone web app — it is **not** served from inside your Nextcloud instance.
That means every API call it makes is a genuine cross-origin request, and browsers block those
unless the server explicitly allows it via CORS headers. This is already fixed in the
accompanying **Nextcloud app patch** (delivered separately — see its README), which does two
things:

1. **Every FinTrack API controller** (`AccountsController`, `TransactionsController`,
   `TransfersController`, `BudgetsController`, `CategoriesController`, `CurrenciesController`,
   `RecurringController`, `SettingsController`, `LockController`, `ExternalController`) now
   carries Nextcloud's built-in `#[CORS]` attribute on every endpoint. This only actually takes
   effect for non-cookie-authenticated requests (HTTP Basic Auth with an app password, or
   `ExternalController`'s token auth) — Nextcloud's own CORS middleware refuses to add
   `Access-Control-Allow-Origin` for session/cookie-authenticated requests specifically to stop
   CORS from becoming a CSRF hole, so this doesn't weaken same-origin session security at all.
2. **A new `LoginProxyController`** relays Nextcloud core's Login Flow v2
   (`/index.php/login/v2`) — which lives in core, not the FinTrack app, and so can't carry CORS
   headers without patching core itself (unsupported, overwritten on every update). It makes the
   two Login Flow v2 calls server-to-server instead (no browser involved on that hop, so no CORS
   applies to it) and exposes them under FinTrack's own CORS-enabled routes:
   `POST /apps/fintrack/login-proxy/init` and `POST /apps/fintrack/login-proxy/poll`. This PWA's
   `api.js` already calls those proxy routes instead of core directly.

**You must install the accompanying Nextcloud app patch for this PWA to work at all** — without
it, you'll see the exact "blocked by CORS policy" browser error, since nothing server-side allows
the cross-origin request yet.

**If you can't modify the Nextcloud app at all** (e.g. third-party/managed hosting), the fallback
is web-server-level config instead — add `Access-Control-Allow-Origin` (scoped to this PWA's exact
origin, not `*`) for `/index.php/login/v2` and `/index.php/apps/fintrack/` at your reverse
proxy (Nginx/Apache), or simplest of all, host this PWA's files on the *same origin* as Nextcloud
so no cross-origin request happens in the first place.

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
custom shortcut — relayed through FinTrack's own `LoginProxyController` so it's reachable
cross-origin (see the CORS section above):

1. `POST /apps/fintrack/login-proxy/init` (which itself calls Nextcloud core's
   `/index.php/login/v2` server-side) — returns a `login` URL and a `poll` token/endpoint.
2. The `login` URL opens in a new tab where the person authenticates directly with Nextcloud (the
   PWA never sees their Nextcloud password).
3. The PWA polls `/apps/fintrack/login-proxy/poll` every 2 seconds; once the person approves, it
   receives a Nextcloud **app password** (not their real password) plus their login name.
4. Every subsequent API call uses HTTP Basic Auth with `loginName:appPassword` — identical to how
   the Android app and Nextcloud's own official clients authenticate.

The app password can be revoked at any time from Nextcloud's own **Settings → Security** page
without affecting the person's main account password.

## Pin Lock — synced with the main app, not a separate PIN

This PWA does **not** maintain its own separate PIN. It uses the exact same **Pin Lock** as
FinTrack's Settings in the main (web) app (`LockController`/`LockService` server-side):

- **First login, Pin Lock already enabled elsewhere:** the PWA asks for that existing PIN and
  confirms it against the server (`POST api/lock/verify`) before setting this device up.
- **First login, Pin Lock not enabled yet:** the PWA offers to enable it (`POST api/lock/setup`) —
  doing so from the PWA enables it in the main app too, since it's the same setting.
- **Every unlock** tries the server first when online (authoritative — reflects the real
  enabled/timeout/lockout state no matter which client last changed it, and enforces the same
  5-attempts/15-minute lockout as the main app). If the PIN was changed or disabled elsewhere
  since this device last synced, the PWA detects that and asks for a fresh login rather than
  trusting stale local state.
- **Offline**, it falls back to a local check: the PIN-derived AES key either successfully
  decrypts the locally-stored session or it doesn't (AES-GCM's authentication tag makes a wrong
  key fail loudly) — no separate local PIN verifier needed at all.
- **Settings → Pin Lock** in the PWA calls the same `setup`/`disable` endpoints — changing or
  disabling it there changes it for the main app too, and vice versa.

## Security model — what's actually protected, and what isn't

- **Per-user isolation.** Every Nextcloud identity (server + login name) that has ever signed in
  on this device gets its own IndexedDB database (`fintrack_data_<hash>`), so multiple people
  using FinTrack in the same browser profile never share storage.
- **Encryption at rest.** Every value written to IndexedDB — the app password, cached
  accounts/transactions/etc, settings — is AES-256-GCM encrypted. The key is derived via PBKDF2
  (210,000 rounds, SHA-256) from the Pin Lock PIN (the same one from FinTrack's Settings in the
  main app — see below). The PIN itself is never stored locally at all: a wrong PIN simply fails
  to decrypt the stored session (AES-GCM's authentication tag makes this fail loudly, not
  silently), which doubles as the offline PIN check — no separate local verifier hash needed.
- **Every fresh page load re-asks for the PIN**, no exceptions — nothing sensitive is kept in
  memory across a reload. A live, already-unlocked session also re-locks after the
  server-configured timeout if the tab is hidden/backgrounded that long.
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

Everything the Android app has, plus several options it intentionally leaves out:

- **CSV bulk import** for transactions, with a downloadable template.
- **Currencies CRUD** (code, name, symbol, manual conversion rate) — Android only lets you *pick*
  an existing currency when creating an account.
- **External API / Quick Add token management** — view/copy/regenerate your personal API token,
  and a ready-to-copy Quick Add URL for bookmarklets/shortcuts. Not present in the Android app.
- **Full Tags management** (add/remove global tags), not just per-transaction tagging.
- **Recurring "Post now"** action, same as Android.
- **Pin Lock setup/change/disable** directly from the PWA (synced with the main app — see above).
- Every entity (Accounts, Transactions, Transfers, Budgets, Categories, Currencies, Recurring)
  supports full CRUD with every field the API accepts.

### Real backend surface not yet wired up in this PWA

Inspecting the actual Nextcloud app's controllers turned up several endpoints this PWA doesn't
have a UI for yet — noting them honestly rather than silently leaving them out:

- Transaction **trash/recycle bin** (`restoreFromTrash`, `destroyFromTrash`, `emptyTrash`) —
  deletes are permanent in this PWA today, unlike the main app's soft-delete.
- **Exchange rate lookup + API key testing** (`currencies/exchange-rate`,
  `currencies/test-exchange-rate-key`) — currency conversion rates are manual-entry only here.
- **Category export/import/create-defaults** (`categories/export`, `categories/import`,
  `categories/create-defaults`).
- **Tag rename** (`settings/rename-tag`) — this PWA can only add/remove tags, not rename one
  in place across every transaction that uses it.
- **Settings reset/restore** (`settings/reset`, `settings/restore`) and **category rules**.
- Pin Lock's **forgot-PIN recovery flow** (`lock/reset-question`, `lock/reset-verify`,
  `lock/request-admin-reset`) — if you truly forget your PIN, use the main app's recovery flow for
  now; the PWA's own "forgot PIN" only removes this device's local copy, it doesn't reset the PIN
  itself.

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
│   ├── pin.js          — Pin Lock logic, synced with the server (see "Pin Lock" above)
│   ├── api.js          — FinTrack REST API client + Nextcloud Login Flow v2 (via login-proxy)
│   ├── app.js           — bootstrap, auth screens, router shell, generic form builder
│   └── sections.js      — every entity's view (Dashboard, Transactions, Accounts, ...)
└── icons/               — app icons (same "FT on blue" branding as the Android app)
```

The corresponding Nextcloud app changes (CORS + `LoginProxyController`) ship as a separate
deliverable — see its own README for exactly what changed and why.
