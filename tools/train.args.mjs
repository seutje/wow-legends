// Argument parsing for tools/train.mjs
// Usage: npm run train -- <population> <generations> <reset> <useMctsOpponent>
// - population: integer (default 100)
// - generations: integer (default 10)
// - reset: true/false/1/0/yes/no (default false)
// - useMctsOpponent: true/false/mcts/best (default true => hard MCTS; false => saved NN opponent)

export function parseTrainArgs(argv = process.argv) {
  const [, , popArg, genArg, resetArg, opponentArg] = argv;

  const toInt = (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  };
  const toBool = (v) => {
    if (typeof v !== 'string') return false;
    return /^(true|1|yes|y)$/i.test(v);
  };
  const parseOpponent = (v) => {
    if (v == null) return 'mcts';
    const text = String(v).trim().toLowerCase();
    if (/^(true|1|yes|y|mcts|baseline|default)$/.test(text)) return 'mcts';
    if (/^(false|0|no|n|best|prev|previous|nn|model)$/.test(text)) return 'best';
    return 'mcts';
  };

  const pop = toInt(popArg) ?? 100;
  const gens = toInt(genArg) ?? 10;
  const reset = toBool(resetArg);
  const opponent = parseOpponent(opponentArg);

  return { pop, gens, reset, opponent };
}

