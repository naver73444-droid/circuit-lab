import test from "node:test";
import assert from "node:assert/strict";
import { createLazyController } from "../../src/workspace-tabs.js";

function fakeDocument() {
  const make = tag => {
    const node = { tag, children: [], dataset: {}, attrs: {}, listeners: {}, textContent: '', className: '',
      setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); },
      addEventListener(type, fn) { this.listeners[type] = fn; }, remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); } };
    return node;
  };
  const host = make('div');
  host.prepend = function (node) { node.parent = this; this.children.unshift(node); };
  globalThis.document = { createElement: make };
  return host;
}

test('lazy controller loads once, shares one instance, and clears its status node', async () => {
  const host = fakeDocument();
  let loads = 0, creates = 0;
  const lazy = createLazyController({ host, load: async () => { loads++; return { make: () => ({ id: ++creates }) }; }, create: (module, h) => { assert.equal(h, host); return module.make(); } });
  assert.equal(lazy.controller, null);
  const ran = [];
  assert.equal(lazy.whenReady(c => ran.push(c.id)), false);
  assert.equal(host.dataset.workspaceLoading, 'loading');
  lazy.whenReady(c => ran.push(c.id));
  const controller = await lazy.ensure();
  await Promise.resolve();
  assert.equal(loads, 1); assert.equal(creates, 1);
  assert.equal(lazy.controller, controller);
  assert.equal(host.dataset.workspaceLoading, undefined);
  assert.deepEqual(ran, [1, 1]);
  assert.equal(lazy.whenReady(c => ran.push(c.id)), true, 'ready controller runs synchronously');
});

test('lazy controller reports failure with a retry button and retries with a cache-busting suffix', async () => {
  const host = fakeDocument();
  const urls = [];
  const lazy = createLazyController({ host, load: async suffix => { urls.push(suffix); if (urls.length === 1) throw new Error('offline'); return {}; }, create: () => ({ ok: true }) });
  let ready = null;
  lazy.whenReady(c => { ready = c; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(host.dataset.workspaceLoading, 'error');
  const status = host.children[0];
  assert.equal(status.attrs.role, 'alert');
  const button = status.children.find(child => child.tag === 'button');
  assert.equal(button.textContent, '다시 시도');
  button.listeners.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(urls, ['', '?retry=1']);
  assert.deepEqual(ready, { ok: true });
  assert.equal(host.dataset.workspaceLoading, undefined);
});

test('prefetch never constructs a controller and swallows load failures', async () => {
  const host = fakeDocument();
  let created = 0;
  const lazy = createLazyController({ host, load: async () => { throw new Error('x'); }, create: () => { created++; } });
  lazy.prefetch();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(created, 0); assert.equal(lazy.controller, null);
});
