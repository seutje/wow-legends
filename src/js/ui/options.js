export function renderOptions(container, { onReset }) {
  container.innerHTML = '';
  const h = document.createElement('h3'); h.textContent = 'Options'; container.appendChild(h);
  const reset = document.createElement('button'); reset.textContent = 'Reset Profile'; reset.onclick = onReset; container.appendChild(reset);
}
