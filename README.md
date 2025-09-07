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
- Your Turn — controls at the top of the page:
  - Draw: Draw 1 card from your Library to your Hand.
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
- HUD: Shows both heroes’ HP and your current pool/available resources.

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
- Simulation CLI: `npm run simulate` (quick AI turns). Balance sampling: `node tools/balance.mjs`.
- Content pipeline: `node tools/cards-ingest.mjs` parses `CARDS.md` to `data/cards.json` (best effort).
- Live reload policy: `live-reload.json` must be committed; never add to `.gitignore`.
