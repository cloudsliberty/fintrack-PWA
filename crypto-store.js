export class SecureUserStore {
  constructor(dbName = 'FinTrackSecureDB') {
    this.dbName = dbName;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('userData')) {
          const store = db.createObjectStore('userData', { keyPath: 'id' });
          store.createIndex('userId', 'userId', { unique: false });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async _deriveKey(pinOrPassword, saltHex) {
    const enc = new TextEncoder();
    const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    const keyMaterial = await crypto.subtle.importKey(
      "raw", enc.encode(pinOrPassword), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async saveEncryptedData(userId, secretKeySource, keyName, payload) {
    let saltHex = localStorage.getItem(`salt_${userId}`);
    if (!saltHex) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(`salt_${userId}`, saltHex);
    }

    const key = await this._deriveKey(secretKeySource, saltHex);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(JSON.stringify(payload))
    );

    const record = {
      id: `${userId}_${keyName}`,
      userId,
      keyName,
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted))
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('userData', 'readwrite');
      tx.objectStore('userData').put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getDecryptedData(userId, secretKeySource, keyName) {
    const saltHex = localStorage.getItem(`salt_${userId}`);
    if (!saltHex) return null;

    const record = await new Promise((resolve) => {
      const tx = this.db.transaction('userData', 'readonly');
      const req = tx.objectStore('userData').get(`${userId}_${keyName}`);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });

    if (!record) return null;

    try {
      const key = await this._deriveKey(secretKeySource, saltHex);
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(record.iv) },
        key,
        new Uint8Array(record.data)
      );
      return JSON.parse(new TextDecoder().decode(decrypted));
    } catch (e) {
      console.error("Decryption failed. Invalid credentials or corrupted payload.");
      return null;
    }
  }
}
