export function renderOptions(container, { onReset, onToggleLogs }) {
  container.innerHTML = '';
  const h = document.createElement('h3'); h.textContent = 'Options'; container.appendChild(h);
  const reset = document.createElement('button'); reset.textContent = 'Reset Profile'; reset.onclick = onReset; container.appendChild(reset);
  const toggle = document.createElement('button'); toggle.textContent = 'Toggle Logs'; toggle.onclick = onToggleLogs; container.appendChild(toggle);
}

