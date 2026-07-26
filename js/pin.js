// FinTrack PWA — pin.js
//
// Mirrors the Android app's "PIN Lock" settings section: a PIN with a configurable background
// timeout (in minutes), always required on a fresh page load, not re-asked if the tab was only
// briefly hidden/backgrounded within the timeout. This PIN also doubles as the passphrase that
// derives the AES key protecting everything in this identity's IndexedDB store (see crypto.js) —
// so "PIN Lock" here isn't just a UI gate, it's the actual encryption key for local data.

const FT_PIN = (() => {
  let unlockedKey = null; // CryptoKey, in memory only, cleared on lock/reload
  let unlockedIdentityId = null;
  let hasUnlockedThisPageLoad = false;

  function bgKey(identityId) {
    return `backgroundedAt:${identityId}`;
  }

  async function getIdentity(identityId) {
    const all = await FT_DB.listIdentities();
    return all.find((i) => i.id === identityId) || null;
  }

  function isEnabled(identity) {
    return !!(identity && identity.pinEnabled);
  }

  function timeoutMinutes(identity) {
    return identity && typeof identity.pinTimeoutMinutes === 'number' ? identity.pinTimeoutMinutes : 5;
  }

  /** Sets up (or changes) the PIN for an identity record that's about to be saved. Returns the fields to merge in. */
  async function buildPinFields(pin, timeoutMinutes) {
    const pinSalt = FT_CRYPTO.toB64(FT_CRYPTO.randomBytes(16));
    const encSalt = FT_CRYPTO.toB64(FT_CRYPTO.randomBytes(16));
    const pinVerifier = await FT_CRYPTO.derivePinVerifier(pin, FT_CRYPTO.fromB64(pinSalt));
    return { pinEnabled: true, pinSalt, encSalt, pinVerifier, pinTimeoutMinutes: timeoutMinutes };
  }

  async function verifyAndUnlock(identityId, pin) {
    const identity = await getIdentity(identityId);
    if (!identity || !identity.pinEnabled) return false;
    const verifier = await FT_CRYPTO.derivePinVerifier(pin, FT_CRYPTO.fromB64(identity.pinSalt));
    if (verifier !== identity.pinVerifier) return false;
    unlockedKey = await FT_CRYPTO.deriveKey(pin, FT_CRYPTO.fromB64(identity.encSalt));
    unlockedIdentityId = identityId;
    hasUnlockedThisPageLoad = true;
    localStorage.removeItem(bgKey(identityId));
    return true;
  }

  /** For identities with no PIN configured yet (first run) — derives a key straight away, no verification needed. */
  async function unlockWithNewPin(identityId, pin, encSalt) {
    unlockedKey = await FT_CRYPTO.deriveKey(pin, FT_CRYPTO.fromB64(encSalt));
    unlockedIdentityId = identityId;
    hasUnlockedThisPageLoad = true;
  }

  function currentKey(identityId) {
    return unlockedIdentityId === identityId ? unlockedKey : null;
  }

  function lock() {
    unlockedKey = null;
    unlockedIdentityId = null;
    hasUnlockedThisPageLoad = false;
  }

  function recordBackgrounded(identityId) {
    localStorage.setItem(bgKey(identityId), String(Date.now()));
  }

  async function isLockRequiredNow(identityId) {
    const identity = await getIdentity(identityId);
    if (!isEnabled(identity)) return false;
    if (!hasUnlockedThisPageLoad || unlockedIdentityId !== identityId) return true;
    const backgroundedAt = Number(localStorage.getItem(bgKey(identityId)) || 0);
    if (!backgroundedAt) return false;
    const timeoutMs = timeoutMinutes(identity) * 60_000;
    return Date.now() - backgroundedAt >= timeoutMs;
  }

  return { getIdentity, isEnabled, timeoutMinutes, buildPinFields, verifyAndUnlock, unlockWithNewPin, currentKey, lock, recordBackgrounded, isLockRequiredNow };
})();

// Track visibility changes so a brief tab-switch doesn't re-lock, but a longer one (past the
// configured timeout) does — mirrors the Android app's ON_STOP/ON_START lifecycle handling.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && window.FT_APP && window.FT_APP.currentIdentityId) {
    FT_PIN.recordBackgrounded(window.FT_APP.currentIdentityId);
  }
});
