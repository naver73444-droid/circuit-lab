import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('collapsible help is short, reachable, and every documented path is registered in code', async () => {
  const [html, app, touch] = await Promise.all([read('../index.html'), read('../src/app.js'), read('../src/canvas-touch.js')]);
  assert.match(html, /<details class="interaction-help" id="interaction-help"><summary>조작 도움말<\/summary>/);
  const card = html.match(/<div class="interaction-help-card">([\s\S]*?)<\/div><\/details>/)?.[1] ?? '';
  assert.ok((card.match(/<li>/g) ?? []).length <= 8, 'help stays at 8 lines or fewer');
  for (const heading of ['선택·이동', '배선·값', '프로브·그래프', '단축키']) assert.ok(card.includes(`<b>${heading}</b>`), heading);
  assert.doesNotMatch(html, /패널·입력|배치 메뉴|구분선/, 'no panel-layout help remains');
  assert.match(app, /event\.key\.toLowerCase\(\) === "r"/);
  assert.match(app, /event\.key\.toLowerCase\(\) === "d"/);
  assert.match(app, /event\.key\.toLowerCase\(\) === "z"/);
  assert.match(app, /event\.key\.toLowerCase\(\) === "y"/);
  assert.match(app, /event\.key === "Delete"/);
  assert.match(app, /scopeView\.keyCursor\(event\.key\)/);
  assert.match(touch, /viewForPinch/);
  assert.match(touch, /api\.finish\(first\.id, "cancel"\)/);
});

test('help is a presentation-only popover: desktop absolute card, phone fixed card with internal scroll', async () => {
  const css = await read('../styles.css');
  assert.match(css, /\.interaction-help-card \{ position: absolute;/);
  assert.match(css, /@media \(max-width: 899px\)[\s\S]*\.interaction-help-card \{ position: fixed;/);
  assert.match(css, /\.interaction-help-card \{[^}]*overflow: auto;/);
});
