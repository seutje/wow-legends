export class Campaign {
  constructor(quests = []) { this.quests = quests; this.index = 0; }
  current() { return this.quests[this.index] || null; }
  completeCurrent() { if (this.index < this.quests.length) this.index++; }
}

export default Campaign;

