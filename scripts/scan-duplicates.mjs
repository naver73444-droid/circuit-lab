/** Exact repeated windows, for review only. Not a parser or semantic duplication score. */
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../src/', import.meta.url), windows = new Map(), inventory = [];
for (const name of (await readdir(root)).filter(name => name.endsWith('.js')).sort()) {
  const data = await readFile(new URL(name, root)), lines = data.toString('utf8').trimEnd().split('\n');
  inventory.push({ path: `src/${name}`, lines: lines.length, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  const normalized = lines.map((line, i) => ({ line: i + 1, text: line.trim().replace(/\s+/g, ' ') })).filter(item => item.text && !/^(\/\/|\/\*\*|\*)/.test(item.text));
  for (let i = 0; i <= normalized.length - 7; i++) {
    const block = normalized.slice(i, i + 7).map(item => item.text).join('\n');
    if (block.length < 240) continue;
    if (!windows.has(block)) windows.set(block, []);
    windows.get(block).push({ path: `src/${name}`, startLine: normalized[i].line, endLine: normalized[i + 6].line });
  }
}
const groups = [...windows].filter(([, locations]) => locations.length > 1).map(([text, locations]) => ({ text, locations }));
console.log(JSON.stringify({ method: '7 consecutive nonempty lines; whitespace-normalized; >=240 characters; exact matches, not AST or semantic proof', scope: fileURLToPath(root), fileInventory: inventory, repeatedWindows: groups.length, groups }, null, 2));
