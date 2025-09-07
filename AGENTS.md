Project Guidance for AI Agents

Overview
- This project is a browser-based RPG RCG game using ES modules, classes, and Jest tests.
- Game design explained in detail in `DESIGN.md`.
- Dev workflow uses a tiny live-reload mechanism based on a JSON file written by a watcher.

Local Development
- Install deps: `npm ci`
- Start dev server + watcher (the user is already running the dev server): `npm run dev`
  - `npm run dev:serve` serves via `http-server` on port 8000 (no cache)
  - `npm run dev:watch` writes `live-reload.json` whenever files change, don't manually delete or edit `live-reload.json`
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

Testing
- Run tests: `npm test`
- Add or update tests under `__tests__/` for every new module or behavior change.

Live Reload Requirements (Important)
- The live-reload mechanism relies on `live-reload.json` in the project root.
- Always include `live-reload.json` in commits. Do not add it to `.gitignore`.
- When committing, prefer `git add -A` or explicitly stage `live-reload.json` along with your changes.
- If your changes don’t naturally update the file (e.g., documentation-only changes), you may run `npm run dev:watch` briefly to refresh the file, or manually bump its `time` value to ensure it’s included.

Commit Practices
- Use concise, descriptive commit messages (conventional style preferred, e.g., `feat:`, `fix:`, `refactor:`).
- Make atomic commits (one logical change per commit) and include tests/updates that keep the repo green.
- Ensure `live-reload.json` is staged in each commit as noted above.

PR/Change Checklist
- Lint/format if applicable.
- All tests pass locally.
- Docs (including this file) updated when dev workflow or expectations change.

