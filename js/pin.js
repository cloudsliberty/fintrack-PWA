// FinTrack PWA — pin.js
//
// Defers entirely to the same "Settings -> Pin Lock" the main Nextcloud app uses
// (LockController / LockService server-side) — the exact same PIN, the exact same
// enabled/timeout/lockout state, whichever client set it up. That's what "the PIN should work
// according to the main app's settings" means here: this is not a second, separate PIN.
//
// Local encryption key derivation doubles as the offline-capable local check: the PIN-derived
// AES key either successfully decrypts this identity's stored session (AES-GCM's authentication
// tag makes a wrong key fail loudly, not silently) or it doesn't — no separate local verifier
// hash needed. Whenever online, the server's api/lock/verify is *also* called as the source of
// truth (it enforces the real lockout/rate-limit state and catches the case where the PIN was
// changed on another device/the main app since this one last synced).

const FT_PIN = (() => {
  let unlockedKey = null; // CryptoKey, in memory only
  let unlockedIdentityId = null;
  let hasUnlockedThisPageLoad = false;
  let cachedServerStatus = null;

  function bgKey(identityId) { return `backgroundedAt:${identityId}`; }

  async function getIdentity(identityId) {
    const all = await FT_DB.listIdentities();
    return all.find((i) => i.id === identityId) || null;
  }

  function currentKey(identityId) {
    return unlockedIdentityId === identityId ? unlockedKey : null;
  }

  function lock() {
    unlockedKey = null;
    unlockedIdentityId = null;
    hasUnlockedThisPageLoad = false;
    cachedServerStatus = null;
  }

  function recordBackgrounded(identityId) {
    localStorage.setItem(bgKey(identityId), String(Date.now()));
  }

  function markUnlocked(identityId, key) {
    unlockedKey = key;
    unlockedIdentityId = identityId;
    hasUnlockedThisPageLoad = true;
    localStorage.removeItem(bgKey(identityId));
  }

  /**
   * Attempts to unlock this identity with `pin`. Tries the local decrypt first (works offline),
   * then — if online — cross-checks with the server, which is always the authoritative source
   * for enabled/timeout/lockout state and catches a PIN changed elsewhere.
   * Returns { ok: true, offline? } | { ok: false, error, lockedUntil?, staleDevice? }.
   */
  async function tryUnlock(identityId, pin) {
    const identity = await getIdentity(identityId);
    if (!identity || !identity.encSalt) return { ok: false, error: 'This device has no record of this account yet — please log in again.' };

    let key, session;
    try {
      key = await FT_CRYPTO.deriveKey(pin, FT_CRYPTO.fromB64(identity.encSalt));
      session = await FT_DB.getDecrypted(identityId, 'secure', 'session', key);
      if (!session) throw new Error('empty session');
    } catch (e) {
      return { ok: false, error: 'Incorrect PIN' };
    }

    markUnlocked(identityId, key);

    try {
      await FT_API.verifyLock(session, pin);
      const status = await FT_API.getLockStatus(session);
      cachedServerStatus = status;
      await FT_DB.saveIdentity({ ...identity, cachedLockStatus: status });
      return { ok: true };
    } catch (err) {
      if (err.status === 401) {
        // The server disagrees, even though our locally-cached key decrypted fine — the PIN must
        // have been changed elsewhere since this device last synced its local copy. Don't trust
        // the stale local state; require a fresh login instead of silently accepting it forever.
        lock();
        return { ok: false, error: 'Your Pin Lock settings changed elsewhere (PIN changed or disabled). Please log in again to sync this device.', staleDevice: true };
      }
      if (err.status === 423) {
        return { ok: false, error: err.message || 'Too many attempts', lockedUntil: err.body && err.body.lockedUntil };
      }
      // Network/server unreachable — the local decrypt already succeeded, so proceed offline.
      return { ok: true, offline: true, session };
    }
  }

  /** Sets up a brand-new PIN for this identity (server-side, same as Settings -> Pin Lock in the main app) and caches it locally. */
  async function setupNewPin(identityId, pin, timeoutMinutes, session) {
    await FT_API.setupLock(session, { newPassword: pin, timeoutMinutes });
    await adoptLocally(identityId, pin, session, timeoutMinutes);
  }

  /** Changes an already-enabled PIN (requires the current one) — one setupLock call, then re-derives the local key. */
  async function changePin(identityId, currentPin, newPin, timeoutMinutes, session) {
    await FT_API.setupLock(session, { newPassword: newPin, currentPassword: currentPin, timeoutMinutes });
    await adoptLocally(identityId, newPin, session, timeoutMinutes);
  }

  async function adoptLocally(identityId, pin, session, timeoutMinutes) {
    const encSalt = FT_CRYPTO.toB64(FT_CRYPTO.randomBytes(16));
    const key = await FT_CRYPTO.deriveKey(pin, FT_CRYPTO.fromB64(encSalt));
    const identity = (await getIdentity(identityId)) || { id: identityId };
    const status = await FT_API.getLockStatus(session).catch(() => ({ enabled: true, timeoutMinutes }));
    await FT_DB.saveIdentity({ ...identity, encSalt, cachedLockStatus: status });
    await FT_DB.putEncrypted(identityId, 'secure', 'session', key, session);
    markUnlocked(identityId, key);
  }

  /** Confirms an EXISTING server-side PIN (set up elsewhere — the main app, or another device) and adopts it locally. */
  async function adoptExistingPin(identityId, pin, session) {
    await FT_API.verifyLock(session, pin); // throws if wrong
    await adoptLocally(identityId, pin, session, undefined);
  }

  async function isLockRequiredNow(identityId) {
    const identity = await getIdentity(identityId);
    const enabled = identity && identity.cachedLockStatus ? identity.cachedLockStatus.enabled : false;
    if (!enabled) return false;
    if (!hasUnlockedThisPageLoad || unlockedIdentityId !== identityId) return true;
    const backgroundedAt = Number(localStorage.getItem(bgKey(identityId)) || 0);
    if (!backgroundedAt) return false;
    const timeoutMinutes = identity.cachedLockStatus.timeoutMinutes ?? 10;
    return Date.now() - backgroundedAt >= timeoutMinutes * 60_000;
  }

  return {
    getIdentity, currentKey, lock, recordBackgrounded, tryUnlock, setupNewPin, changePin, adoptExistingPin,
    isLockRequiredNow, getCachedStatus: () => cachedServerStatus
  };
})();

// Track visibility changes so a brief tab-switch doesn't re-lock, but a longer one (past the
// server-configured timeout) does — mirrors how the Android app handles ON_STOP/ON_START.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && window.FT_APP && window.FT_APP.currentIdentityId) {
    FT_PIN.recordBackgrounded(window.FT_APP.currentIdentityId);
  }
});
