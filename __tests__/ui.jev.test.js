/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import JevSession from '../src/js/systems/jev-session.js';
import { renderPlay } from '../src/js/ui/play.js';

beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); sessionStorage.clear(); });

test('Jev key dialog saves only on request, then clears in memory', () => {
  const game = new Game();
  game.turns.setActivePlayer(game.player);
  const session = new JevSession();
  const root = document.createElement('div');
  document.body.append(root);
  const render = () => renderPlay(root, game, { jevSession: session, onUpdate: render });
  render();
  const selector = document.querySelector('.select-opponent-agent');
  selector.value = 'jev';
  selector.dispatchEvent(new Event('change'));
  const openButton = document.querySelector('.jev-open');
  const dialog = document.querySelector('.jev-key-dialog');
  const input = dialog.querySelector('.jev-key');
  expect(openButton.textContent).toBe('Set OpenRouter key');
  expect(openButton.hidden).toBe(false);
  expect(dialog.hasAttribute('open')).toBe(false);
  expect(input.type).toBe('password');
  expect(document.querySelector('.jev-status')).toBeNull();
  expect(dialog.textContent).toContain('Your key is sent directly from this browser to OpenRouter');
  expect(document.querySelector('.btn-end-turn').disabled).toBe(true);

  openButton.click();
  expect(dialog.hasAttribute('open')).toBe(true);
  dialog.querySelector('.jev-save').click();
  expect(dialog.hasAttribute('open')).toBe(true);
  expect(session.configured).toBe(false);
  expect(dialog.querySelector('.jev-dialog-error').textContent).toMatch(/Enter an OpenRouter API key/);
  input.value = 'fake-openrouter-secret-key';
  input.dispatchEvent(new Event('input'));
  expect(session.configured).toBe(false);
  dialog.querySelector('.jev-save').click();
  expect(session.configured).toBe(true);
  expect(dialog.hasAttribute('open')).toBe(false);
  expect(input.value).toBe('');
  expect(document.querySelector('.btn-end-turn').disabled).toBe(false);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);

  openButton.click();
  expect(input.value).toBe('');
  dialog.querySelector('.jev-cancel').click();
  expect(session.configured).toBe(true);
  openButton.click();
  dialog.querySelector('.jev-clear').click();
  expect(session.configured).toBe(false);
  expect(dialog.hasAttribute('open')).toBe(false);
  expect(document.querySelector('.btn-end-turn').disabled).toBe(true);
  expect(JSON.stringify(game.state)).not.toContain('fake-openrouter-secret-key');
  expect(new JevSession().configured).toBe(false);
});

test('Jev errors show safe retry and local modes remain selectable', () => {
  const game = new Game();
  game.state.opponentAgent = 'jev';
  game.agentFailure = 'authentication';
  game.turns.setActivePlayer(game.opponent);
  game.retryOpponentAgentTurn = jest.fn(async () => true);
  const root = document.createElement('div');
  document.body.append(root);
  const render = () => renderPlay(root, game, { jevSession: new JevSession(), onUpdate: render });
  render();
  expect(document.querySelector('.jev-error').textContent).toMatch(/rejected the API key/);
  expect(document.querySelector('.jev-retry').hidden).toBe(false);
  const selector = document.querySelector('.select-opponent-agent');
  selector.value = 'local';
  selector.dispatchEvent(new Event('change'));
  expect(game.state.opponentAgent).toBe('local');
  expect(document.querySelector('.jev-open').hidden).toBe(true);
});
