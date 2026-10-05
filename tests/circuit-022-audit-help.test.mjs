import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('collapsible help is reachable and describes the registered desktop and touch paths', async () => {
  const [html, app, touch] = await Promise.all([
    read('../index.html'),
    read('../src/app.js'),
    read('../src/canvas-touch.js'),
  ]);
  assert.match(html, /<details class="interaction-help" id="interaction-help"><summary>조작 도움말<\/summary>/);
  for (const phrase of ['선택·이동', '배선·값', '프로브·그래프', '패널·입력', '두 손가락은 확대·축소', '입력 칸을 편집하는 동안']) {
    assert.match(html, new RegExp(phrase));
  }
  assert.match(app, /event\.key\.toLowerCase\(\) === "r"/);
  assert.match(app, /event\.key\.toLowerCase\(\) === "d"/);
  assert.match(app, /event\.key\.toLowerCase\(\) === "z"/);
  assert.match(app, /event\.key\.toLowerCase\(\) === "y"/);
  assert.match(app, /event\.key === "Delete"/);
  assert.match(app, /scopeView\.keyCursor\(event\.key\)/);
  assert.match(touch, /viewForPinch/);
  assert.match(touch, /api\.finish\(first\.id, "cancel"\)/);
});

test('help remains a presentation-only responsive overlay and the candidate label is current', async () => {
  const [html, css] = await Promise.all([read('../index.html'), read('../styles.css')]);
  assert.match(css, /\.interaction-help-card \{ position: absolute;/);
  assert.match(css, /\.interaction-help-card \{ position: fixed; left: 8px; right: 8px; top: 166px; bottom: 8px;/);
  assert.match(css, /\.interaction-help-card \{[\s\S]*overflow: auto;/);
  assert.match(html, /022 코드 점검·조작 도움말 후보/);
  assert.doesNotMatch(html, /020 기반 작업공간·페이저 수정 후보/);
});
