/** Disjoint sets for topology and diagnostics. Missing keys must never create an infinite loop. */
export class UnionFind {
  constructor(items, missing = (key) => new Error(`Unknown union-find key: ${key}`)) {
    this.parent = new Map(items.map((item) => [item, item]));
    this.size = new Map(items.map((item) => [item, 1]));
    this.missing = missing;
  }
  find(item) {
    if (!this.parent.has(item)) throw this.missing(item);
    let root = item;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(item) !== item) {
      const next = this.parent.get(item);
      this.parent.set(item, root);
      item = next;
    }
    return root;
  }
  union(first, second) {
    let a = this.find(first);
    let b = this.find(second);
    if (a === b) return;
    if (this.size.get(a) < this.size.get(b)) [a, b] = [b, a];
    this.parent.set(b, a);
    this.size.set(a, this.size.get(a) + this.size.get(b));
  }
}
