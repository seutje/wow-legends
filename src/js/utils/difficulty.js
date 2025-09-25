export function normalizeDifficulty(value) {
  if (typeof value !== 'string') return value;
  if (value === 'hybrid') return 'insane';
  return value;
}
