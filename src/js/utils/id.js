let counter = 0;

function randBase36(n = 3) {
  // Use crypto if available for better uniqueness
  const max = 36 ** n;
  let r;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    r = arr[0] % max;
  } else {
    r = Math.floor(Math.random() * max);
  }
  return r.toString(36).padStart(n, '0');
}

export function shortId(prefix = '') {
  const t = Date.now().toString(36);
  const c = (counter++ & 0xfff).toString(36).padStart(3, '0');
  const r = randBase36(3);
  return `${prefix ? prefix + '-' : ''}${t}${c}${r}`;
}

