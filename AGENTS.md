Project Guidance for AI Agents

Overview
- This project is a browser-based RPG RCG game using ES modules, classes, and Jest tests.
- Game design explained in detail in `DESIGN.md`.
- Dev workflow uses a tiny live-reload mechanism based on a JSON file written by a watcher.

Local Development
- Install deps: `npm ci`
- Start dev server + watcher (the user is already running the dev server): `npm run dev`
  - `npm run dev:serve` serves via `http-server` on port 8000 (no cache)
  - `npm run dev:watch` writes `live-reload.json` whenever files change; ignore these updates and do not commit this file
- Open http://localhost:8000 to play. The client polls `live-reload.json` and reloads on changes.

Code Conventions
- Use ES modules (`type: module`) and modern JS. Prefer classes and small, focused modules.
- Keep logic separated:
  - `src/js/utils/*` utilities (e.g., RNG)
  - `src/js/entities/*` game entities
  - `src/js/systems/*` systems
  - `src/js/game.js` orchestrates the game
  - `src/js/main.js` is the browser entry; it initializes and exposes `window.game` for UI hooks.
- Keep changes minimal and scoped to the request. Update docs and tests when behavior changes.
- Implement cards generically. Do not target specific card IDs; adjust the per-type JSON under `data/` (e.g., `hero.json`, `spell.json`, etc.) and add effect types to cover card-specific behavior.

Testing
- Run tests: `npm test`
- Run linters: `npm run lint`
- Add or update tests under `__tests__/` for every new module or behavior change.

Live Reload Requirements (Important)
- The live-reload mechanism relies on `live-reload.json` in the project root.
- To avoid merge conflicts, never run `npm run live-reload` or manually edit `live-reload.json`.
- Do not commit changes to `live-reload.json`; if the watcher updates it, restore the file before committing.

Commit Practices
- Use concise, descriptive commit messages (conventional style preferred, e.g., `feat:`, `fix:`, `refactor:`).
- Make atomic commits (one logical change per commit) and include tests/updates that keep the repo green.

PR/Change Checklist
- Lint/format if applicable.
- All tests pass locally.
- Docs (including this file) updated when dev workflow or expectations change.
