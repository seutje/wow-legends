const NAMESPACE = 'wow-legends';

function defaultStorage() {
  if (typeof localStorage !== 'undefined') return localStorage;
  // In tests fallback to in-memory
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
}

export class SaveSystem {
  constructor({ storage = defaultStorage(), version = 1 } = {}) {
    this.storage = storage;
    this.version = version;
  }

  key(k) { return `${NAMESPACE}:${k}`; }

  saveProfile(profile) {
    const payload = { v: this.version, profile };
    this.storage.setItem(this.key('profile'), JSON.stringify(payload));
    return true;
  }

  loadProfile() {
    const raw = this.storage.getItem(this.key('profile'));
    if (!raw) return null;
    let data = JSON.parse(raw);
    if ((data.v || 1) !== this.version) data = this.migrate(data);
    return data.profile;
  }

  migrate(data) {
    // Simple passthrough example: ensure profile has decks array
    const out = { v: this.version, profile: data.profile || {} };
    if (!Array.isArray(out.profile.decks)) out.profile.decks = [];
    return out;
  }

  exportDeckCode(deck) {
    const ids = deck.cards.map(c => c.id);
    const json = JSON.stringify({ v: this.version, ids });
    return Buffer.from(json).toString('base64');
  }

  importDeckCode(code) {
    const json = Buffer.from(code, 'base64').toString('utf8');
    return JSON.parse(json);
  }
}

export default SaveSystem;

