import { setDebugLogging, isDebugLogging } from '../utils/logger.js';

export function renderOptions(container, { onReset }) {
  container.innerHTML = '';
  const h = document.createElement('h3'); h.textContent = 'Options'; container.appendChild(h);
  const reset = document.createElement('button'); reset.textContent = 'Reset Profile'; reset.onclick = onReset; container.appendChild(reset);
  const lbl = document.createElement('label');
  const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = isDebugLogging();
  chk.addEventListener('change', () => setDebugLogging(chk.checked));
  lbl.append(chk, document.createTextNode(' Debug logs'));
  container.appendChild(lbl);
}
