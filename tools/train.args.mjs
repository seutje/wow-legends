// Argument parsing for tools/train.mjs
// Usage: npm run train -- <population> <generations> <reset> <opponent>
// - population: integer (default 100)
// - generations: integer (default 10)
// - reset: true/false/1/0/yes/no (default false)
// - opponent: "mcts" (default), "best", or "mcts@<iterations>"
// Additional flags:
//   --curriculum <spec> (alias: --opponent-curriculum, --schedule)
//     * "gentle" enables the built-in ramp that starts with a weak MCTS and
//       escalates to the requested opponent
//     * custom specs: comma-separated `<threshold>:<opponent>` entries (see
//       README for details)

export function parseTrainArgs(argv = process.argv) {
  const tokens = Array.from(argv).slice(2);
  const positional = [];
  const flags = {};

  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const token = raw == null ? '' : String(raw);
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const trimmed = token.replace(/^--+/, '');
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq >= 0) {
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1);
      if (key) flags[key] = value;
      continue;
    }

    const key = trimmed.trim();
    if (!key) continue;
    const next = tokens[i + 1];
    if (next != null && !String(next).startsWith('--')) {
      flags[key] = String(next);
      i += 1;
    } else {
      flags[key] = 'true';
    }
  }

  const toInt = (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  };
  const toBool = (v) => {
    if (typeof v !== 'string') return Boolean(v);
    return /^(true|1|yes|y)$/i.test(v);
  };
  const parseOpponent = (v) => {
    if (v == null) return 'mcts';
    const text = String(v).trim().toLowerCase();
    if (/^(true|1|yes|y|mcts|baseline|default)$/.test(text)) return 'mcts';
    if (/^mcts[@:]\d+$/.test(text)) {
      const [, iterations] = text.split(/[@:]/);
      return `mcts@${iterations}`;
    }
    if (/^(false|0|no|n|best|prev|previous|nn|model|saved)$/.test(text)) return 'best';
    return text || 'mcts';
  };

  const getFlag = (...names) => {
    for (const name of names) {
      if (name in flags) return flags[name];
    }
    return undefined;
  };

  const popArg = positional[0] ?? getFlag('pop', 'population');
  const genArg = positional[1] ?? getFlag('gens', 'gen', 'generations');
  const extras = positional.slice(2);

  const booleanPattern = /^(true|false|1|0|yes|no|y|n)$/i;
  const isLikelyCurriculumToken = (token) => {
    if (token == null) return false;
    const text = String(token).trim();
    if (!text) return false;
    const lowered = text.toLowerCase();
    if (lowered === 'gentle' || lowered === 'default') return true;
    if (lowered.includes(':')) return true;
    if (lowered.startsWith('curriculum=')) return true;
    if (lowered.startsWith('schedule=')) return true;
    if (lowered.startsWith('opponent-curriculum=')) return true;
    return false;
  };

  const resetFlag = getFlag('reset');
  let resetValue = resetFlag;
  if (resetValue == null) {
    const boolIdx = extras.findIndex((token) => booleanPattern.test(String(token).trim()));
    if (boolIdx >= 0) {
      resetValue = extras.splice(boolIdx, 1)[0];
    }
  }

  const opponentFlag = getFlag('opponent', 'baseline');
  let opponentValue = opponentFlag;
  if (opponentValue == null && extras.length > 0) {
    const candidate = extras[0];
    if (!isLikelyCurriculumToken(candidate)) {
      opponentValue = extras.shift();
    }
  }

  let curriculum = getFlag('curriculum', 'opponent-curriculum', 'schedule');
  if (curriculum == null && extras.length > 0) {
    const idx = extras.findIndex((token) => isLikelyCurriculumToken(token));
    if (idx >= 0) {
      const picked = extras.splice(idx, 1)[0];
      if (typeof picked === 'string' && picked.includes('=')) {
        const [, value] = picked.split('=');
        curriculum = value ?? picked;
      } else {
        curriculum = picked;
      }
    }
  }

  const pop = toInt(popArg) ?? 100;
  const gens = toInt(genArg) ?? 10;
  const reset = toBool(resetValue);
  const opponent = parseOpponent(opponentValue);

  if (typeof curriculum === 'string') {
    const trimmed = curriculum.trim();
    if (!trimmed || /^(false|0|no|off)$/i.test(trimmed)) curriculum = null;
    else if (/^(true|1|yes|on)$/i.test(trimmed)) curriculum = 'gentle';
    else curriculum = trimmed;
  } else {
    curriculum = null;
  }

  return { pop, gens, reset, opponent, curriculum };
}

