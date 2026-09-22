WoW Legends
===========

A browser-based RPG TCG prototype with a simple playable skirmish (You vs AI).

Getting Started
- Install dependencies: `npm ci`
- Start dev server + watcher: `npm run dev`
- Open the game in your browser: http://localhost:8000
- Auto-reload: the client polls `live-reload.json` and refreshes on changes.

How To Play
- Goal: Reduce the enemy hero’s health to 0 before yours reaches 0.
- At the start of each turn, you automatically draw a card.
- Your Turn — controls at the top of the page:
  - Resolve Combat: Resolves attacks you’ve declared from your Battlefield.
  - End Turn: Ends your turn and lets the AI take a turn. Your next turn starts, you auto-draw 1 card, and your mana increments.
- Playing cards:
  - Click a card in Player Hand to play it to the Battlefield (pays its cost from your current turn’s mana pool).
- Declaring attackers:
  - Click a unit in Player Battlefield to toggle it as an attacker.
  - Click Resolve Combat to deal damage. Unblocked damage hits the enemy hero.
- Enemy AI (simple):
  - On its turn, the AI draws 1, gains mana just like the player, plays the cheapest affordable card, then attacks with all.

Turn & Mana Basics
- Phases: Start → Main → Combat → End (lightweight in UI).
- Mana: Your maximum mana automatically increases by 1 at the start of each of your turns. Paying costs reduces the turn’s pool; the pool refreshes at the start of your next turn.

Combat Basics
- Simultaneous damage between attackers and their blockers.
- Armor reduces incoming damage before health is lost.
- Overflow keyword routes leftover damage to the enemy hero.
- Lethal keyword kills blockers regardless of remaining health.
- Freeze prevents declaring attacks while it lasts.

UI Reference
- Player section: Battlefield, Hand, and a Mana indicator.
- Enemy section: Battlefield, hand count, and Mana indicator.

Troubleshooting
- Nothing happens on changes: ensure `npm run dev` is running and do not delete or ignore `live-reload.json`.
- Port in use: stop other servers or change the port in `package.json` script `dev:serve`.
- Tests failing: run `npm test` to see failures; the project uses ESM + Jest (with jsdom for DOM tests).

Developer Notes
- Code layout:
  - Utilities: `src/js/utils/*`
  - Entities: `src/js/entities/*`
  - Systems: `src/js/systems/*`
  - UI: `src/js/ui/*`
  - Game orchestrator: `src/js/game.js`
  - Browser entry: `src/js/main.js`
- Tests: `__tests__/*`, run with `npm test` or `npm run test:coverage`.
- Local Jev decision client: `OpenRouterDecisionClient` in `src/js/systems/openrouter-decision-client.js` implements `decide(payload)` for `RemoteDecisionAgent`. It sends the serialized state and legal actions to OpenRouter’s native Decisions API (`/api/alpha/decisions`) as one typed choice question. The default model alias is `~typesafe/jev-latest` (the alias accepted by this endpoint). Local tooling can instantiate it with `new OpenRouterDecisionClient({ apiKey: process.env.OPENROUTER_API_KEY })`. Browser gameplay uses a visitor-entered key held only in `JevSession` memory.
- Browser Jev play: choose **Jev** in **Opponent AI**, click **Set OpenRouter key**, enter your key in the dialog, and click **Save key**. Then play normally. Every Jev action, including attacks, uses the legal-action decision loop. **Clear key** in that dialog removes it from memory and blocks further Jev decisions; refreshing the page also clears it. A failed decision stops the opponent turn and offers an explicit retry. Switch to **Local AI** to resume with the selected difficulty. OpenRouter receives the key directly from the browser; no server or build-time secret is used. The current UI supports Jev as the opponent only; autoplay still uses the selected local AI.
- Opt-in live check: set `OPENROUTER_API_KEY` in a local `.env` file or process environment, then run `node tools/test-openrouter-jev.mjs`. This makes one paid request. `.env` and `.env.*` are ignored, except `.env.example`; The harness loads `.env` using Node’s built-in `loadEnvFile`; a process environment value takes precedence.
- Train Nightmare AI:
  - `npm run train -- <population> <generations> <reset> <opponent>` — evolutionary RL saves the best model to `data/models/best.json`. The optional `<opponent>` defaults to `mcts`, or set `best`/`mcts@<iterations>` to start against the saved NN or a weaker MCTS baseline.
  - Add `--curriculum gentle` to ramp from a light MCTS opponent toward the requested baseline automatically. Custom schedules use comma-separated `<scoreThreshold>:<opponent>` entries, e.g. `--curriculum "0:mcts@1500,1.2:mcts@4000,2.0:best"`.
  - Example: `npm run train -- 200 15 true mcts --curriculum gentle`.
- Regularization controls: `--lambda-decor <λ₁>` applies a DeCorr penalty on hidden activations and `--lambda-l2 <λ₂>` adds optional L2 weight decay. Defaults are λ₁ = 0.01 and λ₂ = 0.0001; pass 0 to disable either term. Training logs report both raw win rates and regularized scores so you can observe the impact of the penalties.
- Autoencoder embeddings:
  - `node tools/encode-minions.mjs` samples quick AI vs AI matches and writes `data/datasets/minion-encodings.json` with per-minion feature vectors (attack, health, taunt, rush, stealth, divine shield, windfury, reflect, lifesteal).
  - `node tools/train-autoencoder.mjs` fits a sparse autoencoder (≈20 latent dims) over that dataset and saves weights to `data/models/autoencoder.json`.
  - After retraining the autoencoder, rerun `npm run train` (or `node tools/train.mjs`) so the policy network in `data/models/best.json` matches the updated state encoding.
- EmbeddingGemma text embeddings:
  - `node tools/generate-embeddinggemma.mjs` loads every definition in `data/cards/*.json`, concatenates useful textual fields, and requests an EmbeddingGemma vector for each card.
  - Configure the backend via CLI flags or env vars: set `EMBEDDING_GEMMA_URL` (or `--endpoint`) to your inference endpoint, optionally provide `EMBEDDING_GEMMA_API_KEY`/`--api-key`, and append any custom headers with `--header "Name: Value"`. Use `--payload-key` if the service expects something other than `inputs` for the batched text field.
  - Example: `EMBEDDING_GEMMA_URL=http://localhost:8080/v1/embeddings EMBEDDING_GEMMA_API_KEY=supersecret node tools/generate-embeddinggemma.mjs --batch-size 16 --model embedding-gemma-2b`.
  - The script writes `data/models/embeddinggemma.json`, sorted by `cardId`, containing `{cardId, vector, metadata}` so downstream tooling can reload the embeddings deterministically.
  - For offline work you can append `--mock` (or set `EMBEDDING_GEMMA_MOCK=1`) to generate deterministic placeholder vectors without hitting a backend; adjust `--mock-dims` to match your target embedding width. The committed artifact is generated in this mock mode—regenerate with a real backend after changing card text or when you need fresh embeddings.
- Evaluate NN vs hard MCTS: `npm run eval` — runs a single game with NN as player vs hard MCTS as opponent (max 20 rounds) and prints result summary. Provide a model path to pit two neural AIs: `npm run eval -- data/other-model.json`.
- AI-vs-AI evaluation: `node tools/evaluate-agents.mjs --agent-a neural-mcts --agent-b basic --games 20 --seed 123`. Agents: `basic`, `mcts`, `neural`, `neural-mcts`, `jev`. `--deck-a` and `--deck-b` accept bundled deck names such as `deck1`; both default to `deck1`. Games are mirrored by default, so pass an even total game count; each pair uses the same engine seed with starting sides swapped. `--no-mirror` runs individual games. Results are written to ignored `data/evaluations/` as JSON summaries and JSONL decision events. `tools/agent-evaluation.mjs` exports `runMatch`, `runMirroredPair`, and `runSeries` for programmatic use with injected agents or decision clients.
- Evaluation viewer: open `http://localhost:8000/evaluation.html` while the development server is running. Load a summary JSON file together with its decision JSONL file, or a full JSON result with embedded decisions. The files remain local to the browser. The viewer provides run and game filters, chronological decision navigation, disagreement shortcuts, player-visible state cards, sortable legal-action metrics, probability bars, raw sanitized decision inputs, and Jensen–Shannon divergence when aligned Jev and neural distributions are both available. New exports use schema version 1 and include the state and actions supplied to the decision boundary; older exports still load but cannot show position details they did not record.
- Counterfactual analysis: new evaluation decision events include an evaluation-only engine snapshot and fingerprint. Analyze one position with `npm run analyze:counterfactuals -- --input data/evaluations/run-summary.json --decisions data/evaluations/run-decisions.jsonl --game 1 --decision 3 --iterations 5000 --depth 20 --repeats 3`. Analyze a conservative batch with `--disagreements-only --limit 10`; add `--all-actions` to evaluate every legal action, `--full-sim` for the slower full simulation backend, or `--all` to remove the batch limit. Output is stored separately as `*-counterfactuals.json` and matching results are reused when rerunning the same configuration. Load this JSON alongside the summary and JSONL in `evaluation.html`. Analysis uses seeded, unguided local MCTS and never calls OpenRouter. It uses the captured full engine state, including hidden zones, so it is explicitly labeled `perfect` information while Jev remains `player-visible`. Values use the existing heuristic scale, with terminal wins/losses at ±1000; they are estimates rather than calibrated win probabilities. Current MCTS primarily searches remaining actions within the active turn, so these estimates do not represent exhaustive opponent-response analysis.
- Live Jev evaluations require both `ALLOW_REMOTE_EVALUATION=1` and `--allow-remote`, and are limited to two games unless `--max-remote-games` is raised explicitly. Example: `ALLOW_REMOTE_EVALUATION=1 node tools/evaluate-agents.mjs --agent-a jev --agent-b neural-mcts --games 2 --seed 123 --allow-remote`. The CLI loads a local `.env` through Node after this gate. Live games run sequentially; failed requests are recorded as errors without a win or automatic retry. `--compare-neural` (on by default for Jev) records the neural policy's preferred action on the same visible position without executing it. `--compare-mcts-every N` samples MCTS recommendations. Engine shuffles and draws use the match seed; local MCTS search gets a seeded random stream. Remote Jev replies can still vary. Card instance IDs use timestamps and random values, so raw action signatures can differ between seeded repeats even when action types, descriptions, turns, and winners match. The existing neural agent does not score attack actions, so this harness chooses a canonical attack when its policy would end a turn; treat that adapter as a baseline limitation when interpreting results.
- Simulation CLI: `npm run simulate` (quick AI turns). Balance sampling: `node tools/balance.mjs`.
- Content pipeline: `node tools/cards-ingest.mjs` parses `CARDS.md` and writes per-type JSON under `data/cards/` (e.g., `data/cards/hero.json`, `data/cards/spell.json`, `data/cards/ally.json`, etc.).
- Live reload policy: `live-reload.json` must be committed; never add to `.gitignore`.
- Asset optimization: `npm run optim` compresses PNGs in `src/assets/art/*.png` (lossless deflate via sharp) and writes optimized copies to `src/assets/optim/` with the same filenames. To optimize a single card image, pass its card id: `npm run optim -- --id spell-mind-vision` (positional also works: `npm run optim -- spell-mind-vision`).

Nightmare AI
- Uses a small MLP with four hidden layers (128, 64, 32, 16 units) to score Q(s,a).
- Inputs include normalized state features (health, armor, mana, board/hand metrics) and action features (type, cost, stats, keywords).
- Output is a scalar score per candidate action; picks the highest.
- Training runs population=500 for 10 generations vs an MCTS baseline (by default) and saves the best model to `data/models/best.json`. Use the `--curriculum` flag to introduce a weaker baseline early and escalate the opponent after the population's top score crosses configured thresholds.
