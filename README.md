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
  - Place Resource (first): Pitch the first card from your Hand to your Resources (limit 1 per turn). Resources determine how many costs you can pay this turn.
  - Resolve Combat: Resolves attacks you’ve declared from your Battlefield.
  - End Turn: Ends your turn and lets the AI take a turn. Your next turn starts and you auto-draw 1 card.
- Playing cards:
  - Click a card in Player Hand to play it to the Battlefield (pays its cost from the current turn’s resource pool).
- Declaring attackers:
  - Click a unit in Player Battlefield to toggle it as an attacker.
  - Click Resolve Combat to deal damage. Unblocked damage hits the enemy hero.
- Enemy AI (simple):
  - On its turn, the AI draws 1, places a resource if possible, plays the cheapest affordable card, then attacks with all.

Turn & Resource Basics
- Phases: Start → Resource → Main → Combat → End (lightweight in UI).
- Resources: Each resource you’ve placed provides 1 available energy per turn. Paying costs reduces the turn’s pool; pool refreshes at the start of your next turn.
- Placement limit: You may place exactly 1 resource per turn.

Combat Basics
- Simultaneous damage between attackers and their blockers.
- Armor reduces incoming damage before health is lost.
- Overflow keyword routes leftover damage to the enemy hero.
- Lethal keyword kills blockers regardless of remaining health.
- Freeze prevents declaring attacks while it lasts.

UI Reference
- Player section: Battlefield, Hand, Resources zones.
- Enemy section: Battlefield, hand count, Resources.

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
- Train Nightmare AI:
  - `npm run train -- <population> <generations> <reset> <opponent>` — evolutionary RL saves the best model to `data/models/best.json`. The optional `<opponent>` defaults to `mcts`, or set `best`/`mcts@<iterations>` to start against the saved NN or a weaker MCTS baseline.
  - Add `--curriculum gentle` to ramp from a light MCTS opponent toward the requested baseline automatically. Custom schedules use comma-separated `<scoreThreshold>:<opponent>` entries, e.g. `--curriculum "0:mcts@1500,1.2:mcts@4000,2.0:best"`.
  - Example: `npm run train -- 200 15 true mcts --curriculum gentle`.
  - Regularization controls: `--lambda-decor <λ₁>` applies a DeCorr penalty on hidden activations and `--lambda-l2 <λ₂>` adds optional L2 weight decay. Training logs report both raw win rates and regularized scores so you can observe the impact of the penalties.
- Autoencoder embeddings:
  - `node tools/encode-minions.mjs` samples quick AI vs AI matches and writes `data/datasets/minion-encodings.json` with per-minion feature vectors (attack, health, taunt, rush, stealth, divine shield, windfury, reflect, lifesteal).
  - `node tools/train-autoencoder.mjs` fits a sparse autoencoder (≈20 latent dims) over that dataset and saves weights to `data/models/autoencoder.json`.
  - After retraining the autoencoder, rerun `npm run train` (or `node tools/train.mjs`) so the policy network in `data/models/best.json` matches the updated state encoding.
- Evaluate NN vs hard MCTS: `npm run eval` — runs a single game with NN as player vs hard MCTS as opponent (max 20 rounds) and prints result summary. Provide a model path to pit two neural AIs: `npm run eval -- data/other-model.json`.
- Simulation CLI: `npm run simulate` (quick AI turns). Balance sampling: `node tools/balance.mjs`.
- Content pipeline: `node tools/cards-ingest.mjs` parses `CARDS.md` and writes per-type JSON under `data/cards/` (e.g., `data/cards/hero.json`, `data/cards/spell.json`, `data/cards/ally.json`, etc.).
- Live reload policy: `live-reload.json` must be committed; never add to `.gitignore`.
- Asset optimization: `npm run optim` compresses PNGs in `src/assets/art/*.png` (lossless deflate via sharp) and writes optimized copies to `src/assets/optim/` with the same filenames. To optimize a single card image, pass its card id: `npm run optim -- --id spell-mind-vision` (positional also works: `npm run optim -- spell-mind-vision`).

Nightmare AI
- Uses a small MLP with four hidden layers (64 units each) to score Q(s,a).
- Inputs include normalized state features (health, armor, resources, board/hand metrics) and action features (type, cost, stats, keywords).
- Output is a scalar score per candidate action; picks the highest.
- Training runs population=500 for 10 generations vs an MCTS baseline (by default) and saves the best model to `data/models/best.json`. Use the `--curriculum` flag to introduce a weaker baseline early and escalate the opponent after the population's top score crosses configured thresholds.
