import SaveSystem from '../src/js/systems/save.js';

describe('SaveSystem', () => {
  test('round-trip save/load profile', () => {
    const save = new SaveSystem({ version: 2 });
    const profile = { name: 'P', decks: [] };
    save.saveProfile(profile);
    const loaded = save.loadProfile();
    expect(loaded).toEqual(profile);
  });

  test('migrates old profile shape', () => {
    const mem = new Map();
    const storage = { getItem: (k)=>mem.get(k)||null, setItem: (k,v)=>mem.set(k,v) };
    // write old payload v:1
    mem.set('wow-legends:profile', JSON.stringify({ v: 1, profile: { name: 'Old' } }));
    const save = new SaveSystem({ version: 2, storage });
    const loaded = save.loadProfile();
    expect(Array.isArray(loaded.decks)).toBe(true);
  });

  test('deck code export/import', () => {
    const save = new SaveSystem();
    const deck = { cards: [{id:'a'},{id:'b'}] };
    const code = save.exportDeckCode(deck);
    const parsed = save.importDeckCode(code);
    expect(parsed.ids).toEqual(['a','b']);
  });
});

