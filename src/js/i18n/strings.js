const dict = new Map();

export function setLang(lang, table) {
  dict.set(lang, table);
}

export function t(key, { lang = 'en', fallback } = {}) {
  const table = dict.get(lang) || {};
  return table[key] || fallback || key;
}

// default en
setLang('en', {
  app_title: 'WoW Legends',
});

