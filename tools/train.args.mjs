// Argument parsing for tools/train.mjs
// Usage: npm run train -- <population> <generations> <reset>
// - population: integer (default 100)
// - generations: integer (default 10)
// - reset: true/false/1/0/yes/no (default false)

export function parseTrainArgs(argv = process.argv) {
  const [, , popArg, genArg, resetArg] = argv;

  const toInt = (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  };
  const toBool = (v) => {
    if (typeof v !== 'string') return false;
    return /^(true|1|yes|y)$/i.test(v);
  };

  const pop = toInt(popArg) ?? 100;
  const gens = toInt(genArg) ?? 10;
  const reset = toBool(resetArg);

  return { pop, gens, reset };
}

