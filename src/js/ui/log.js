export class UILog {
  constructor(container) { this.el = container; }
  log(...args) {
    const line = document.createElement('div');
    line.textContent = args.join(' ');
    this.el.appendChild(line);
  }
  clear() { this.el.innerHTML = ''; }
}

export default UILog;

