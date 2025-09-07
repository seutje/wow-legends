# PLAN: WoW Legends — Development Roadmap

This roadmap breaks development into clear phases with actionable, checkable tasks for AI agents. Favor ES modules, small classes, Jest tests, and the directory layout in AGENTS.md. Human-only tasks are minimized and concentrated near the end.

Conventions
- [ ] = task to complete; keep commits atomic and include `live-reload.json`.
- Tests: For each module/system, add Jest tests under `__tests__/`.
- Structure: Place utilities in `src/js/utils/*`, entities in `src/js/entities/*`, systems in `src/js/systems/*`, orchestrator in `src/js/game.js`, browser entry in `src/js/main.js`.

## Phase 0 — Project Bootstrap
- [x] Scaffold directories: `src/js/utils/`, `src/js/entities/`, `src/js/systems/`, `src/assets/`, `__tests__/`.
- [x] Add minimal `index.html` with root container and script tags loading `src/js/main.js`.
- [x] Implement lightweight client poller for `live-reload.json` (if not already present) that reloads when `time` changes.
- [x] Add `src/js/game.js` with Game shell (lifecycle: init, start, update, reset, dispose).
- [x] Add `src/js/main.js` that instantiates `Game`, attaches it to `window.game`, and wires basic UI hooks.
- [x] Add sample smoke test for environment (ESM + Jest sanity) in `__tests__/env.test.mjs`.

## Phase 1 — Core Utilities
- [x] `utils/rng.js`: Seedable RNG with deterministic sequence, `randomInt`, `pick`, `shuffle`.
- [x] `utils/id.js`: Short id generator for entities/cards.
- [x] `utils/events.js`: Simple typed event bus (subscribe, publish, once) for game systems.
- [x] `utils/logger.js`: Namespaced logger with levels; no-op in production.
- [x] `utils/assert.js`: Dev-time invariant checks and error helpers.
- [x] Tests for all utilities (determinism, edge cases, event ordering).

## Phase 2 — Data Models & Schemas
- [x] Define Type-like JSDoc typedefs for: `Card`, `Hero`, `Ability`, `Ally`, `Equipment`, `Quest`, `Consumable`, `Keyword`.
- [x] Create `entities/card.js` base class and per-type specializations (or composition via `type` field + behavior registry).
- [x] Create `entities/deck.js`, `entities/hand.js`, `entities/zone.js` (draw pile, discard, battlefield, removed).
- [x] Create `entities/player.js` (hero reference, health/armor, resources, status, collection).
- [x] Define JSON schema validators for card data (runtime validation in dev).
- [x] Tests: model creation, serialization, zone movement rules, validation failures.

## Phase 3 — Rules Engine (Turn/Phases/Actions)
- [x] Implement `systems/turns.js` with phases: Start, Resource, Main, Combat, End.
- [x] Implement action queue/stack resolver (`systems/stack.js`) with priority, interrupts, resolution order.
- [x] Implement resource system: pitching cards as resources; per-turn placement rules; cost payment API.
- [x] Implement targeting: selectors, legality checks, prompts.
- [x] Tests: turn progression, illegal action rejection, priority passing, resource payment.

## Phase 4 — Combat System
- [x] `systems/combat.js`: Declare attackers, assign blockers, damage assignment, simultaneous resolution.
- [x] Implement damage, armor, lethal, overflow routing; freeze/stun turns remaining.
- [x] Implement hero attacks and equipment interactions (durability loss on attack/block).
- [ ] Tests: single-unit combat, multi-block, trample/overflow-like effects where applicable, armor interactions.
 - [x] Placeholder images added under `src/assets/`.

## Phase 5 — Keyword & Effect Framework
- [x] Create keyword registry `systems/keywords.js` mapping names → hooks (play, death, damage, upkeep, etc.).
- [x] Implement core keywords from DESIGN/CARDS: Taunt, Stealth, Freeze, Overload, Combo, Lifesteal, Silence, Summon, Burn/DoT, Enrage, Armor, Choose One, Spell Damage, Unique.
- [x] Implement continuous effects and layered modification ordering.
- [x] Tests: each keyword’s core behavior and edge cases (silence removes auras, etc.).

## Phase 6 — Progression Layer
- [x] `systems/progression/xp.js`: XP gain, level thresholds per hero.
- [x] `systems/progression/talents.js`: Talent tree structure, selection rules, deckbuilding modifiers.
- [x] `systems/loot.js`: Loot tables, drops after matches/quests, equipment integration.
- [x] `systems/reputation.js`: Faction rep gains and unlock gates for cards.
- [x] Persistence hooks for progression (see Phase 9).
- [x] Tests: XP math, talent application modifies costs/effects, loot drops deterministic under seeded RNG.

## Phase 7 — Game Modes & AI
- [x] Skirmish (local): Player vs basic AI using heuristic action/value scoring.
- [x] Campaign scaffold: quest chain representation, narrative hooks, rewards on completion.
- [x] Dungeon/Raid encounters: boss script interface (abilities, enrage timers, phases) + sample boss (e.g., Ragnaros).
- [x] Co-op placeholder: hot-seat or simulated ally support in engine (UI can land later).
- [x] Tests: encounter scripts run, victory/defeat conditions, AI turn completes in bounded time.

## Phase 8 — Content Pipeline (Cards/Data)
- [x] Define card data format `data/cards/*.json` (or `.mjs` data modules) aligned with schemas.
- [x] Implement content loader/validator that rejects bad definitions in dev.
- [x] Add Core Set from `CARDS.md` (automated ingestion preferred):
  - [x] Write a small parser in `tools/cards-ingest.mjs` to convert `CARDS.md` sections → JSON, with warnings for unparsed fields.
  - [ ] On failure cases, log actionable notes; avoid manual data where possible.
  - [ ] Human review only for ambiguous entries.
- [x] Tests: sample card parsed equals expected JSON; invalid data surfaced with clear errors.

## Phase 9 — Persistence & Profile
- [x] `systems/save.js`: Save/load profile, collection, decks, campaign progress using `localStorage` namespaced keys.
- [x] Export/import deck codes (base64/short text) for sharing.
- [x] Versioned migrations for save data.
- [x] Tests: round-trip save/load, migration from older versions.

## Phase 10 — UI/UX (First Playable)
- [ ] Render board (DOM/Canvas) with zones: deck, hand, battlefield, hero, graveyard, resources.
- [ ] Click/tap interactions for play, targeting, combat declarations.
- [ ] Simple log/inspector panel for state and effects stack.
- [ ] Deck builder MVP: pick hero, filter by class/faction, 40–60 card rule, talent modifiers.
- [ ] Options menu: seed RNG, reset profile, toggle logs.
- [ ] Tests: interaction unit tests with DOM harness where feasible; integration scenarios via simulation.

## Phase 11 — Dev Tooling & QA
- [ ] Add simulation CLI `tools/simulate.mjs` to run headless games for AI/regression.
- [ ] Ensure `npm run dev` live-reload works end-to-end; document in README.
- [ ] Add coverage reporting and a few golden scenario tests (deterministic seeds).
- [ ] Lint configs (if desired) and CI script examples (local instructions only).

## Phase 12 — Balancing & Polish (Minimize Human Time)
- [ ] Auto-run simulations across archetypes and seeds to generate balance reports.
- [ ] Auto-suggest balance tweaks (cost/ATK/HP) via heuristics; produce diff proposals.
- [ ] Performance pass: profile hot paths (effects resolution, AI search) and optimize.
- [ ] Accessibility pass: keyboard navigation and readable contrasts.
- [ ] Localization scaffold: string table with fallbacks (no translations required yet).

## Phase 13 — Human Review & Launch Prep (Human-Focused)
- [ ] Human: Lore/art/audio review for Warcraft flavor; replace placeholders.
- [ ] Human: Legal/IP review and licensing for names/art/audio.
- [ ] Human: Final balance sweep based on auto reports + playtesting feedback.
- [ ] Human: UX copywriting, microcopy, and tutorial text polish.
- [ ] Human: Release checklist (versioning, changelog, packaging), ensure `live-reload.json` policy followed in all PRs.

## Phase 14 — Stretch Goals (Optional)
- [ ] Online PvP via WebSocket server; sync protocol and reconciliation.
- [ ] Cloud persistence and shared collections.
- [ ] Replay system and spectate mode.
- [ ] Visual effects and richer animations; audio mixing.

## Milestone Snapshots (Definition of Done)
- [ ] M1 First Engine Pass: Phases 0–5 green, basic card plays and combat tested.
- [ ] M2 First Playable: Phases 0–10 green; can play a skirmish end-to-end with a few core decks.
- [ ] M3 Progression Beta: Phases 0–11 green; campaign, loot, talents, and saves working.
- [ ] M4 Release Candidate: Phases 0–13 green; polish complete and docs updated.

Notes
- Prefer automation over manual data entry (parsers, validators, generators).
- Keep systems decoupled via events; avoid global state aside from `window.game` for UI hooks.
- When committing, always include `live-reload.json` (see AGENTS.md).
