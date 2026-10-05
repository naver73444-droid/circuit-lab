/** Uncommitted text belongs to its field, not to the currently rendered DOM. */
export class InputDrafts {
  constructor() { this.values = new Map(); }
  key(kind, id, property) { return JSON.stringify([kind, id, property]); }
  set(kind, id, property, value, committed) {
    const key = this.key(kind, id, property);
    if (String(value) === String(committed ?? "")) this.values.delete(key);
    else this.values.set(key, { kind, id, property, value: String(value) });
  }
  get(kind, id, property) { return this.values.get(this.key(kind, id, property))?.value; }
  delete(kind, id, property) { this.values.delete(this.key(kind, id, property)); }
  clear() { this.values.clear(); }
  entries() { return [...this.values.values()]; }
  get size() { return this.values.size; }
  retainComponents(ids) { for (const [key, item] of this.values) if (item.kind === "prop" && !ids.has(item.id)) this.values.delete(key); }
}
