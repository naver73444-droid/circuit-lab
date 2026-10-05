import test from "node:test";
import assert from "node:assert/strict";
import { base64UrlToBytes, buildShareUrl, bytesToBase64Url, compressionSupported, decodeProjectFromHash, encodeProjectToHash, hasShareHash, SHARE_MAX_DECODED_BYTES, SHARE_TOO_LARGE_REASON } from "../../src/share-url.js";
import { examples } from "../../src/examples.js";

function projectOf(example) {
  const copy = structuredClone(example);
  return { title: copy.name, subtitle: copy.description, circuit: copy.circuit, settings: copy.settings, probes: [] };
}

test("base64url 인코더: 모든 길이/바이트 값 round trip, URL 안전 문자만", () => {
  for (let length = 0; length < 40; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length * 11) % 256);
    const text = bytesToBase64Url(bytes);
    assert.match(text, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual([...base64UrlToBytes(text)], [...bytes]);
  }
  assert.equal(bytesToBase64Url(new TextEncoder().encode("Man")), "TWFu");
  assert.equal(base64UrlToBytes("a"), null);
  assert.equal(base64UrlToBytes("ab+/"), null);
  assert.equal(base64UrlToBytes("ab=="), null);
});

test("모든 예제 round trip (z/압축, j/일반)", async () => {
  assert.equal(compressionSupported(), true, "Node 24에서는 CompressionStream 사용 가능");
  for (const example of examples) {
    const project = projectOf(example);
    for (const compress of [true, false]) {
      const encoded = await encodeProjectToHash(project, { compress });
      assert.equal(encoded.ok, true, `${example.id} ${compress}`);
      assert.equal(encoded.method, compress ? "z" : "j");
      assert.match(encoded.hash, compress ? /^#p=z\.[A-Za-z0-9_-]+$/ : /^#p=j\.[A-Za-z0-9_-]+$/);
      const decoded = await decodeProjectFromHash(encoded.hash);
      assert.equal(decoded.ok, true, `${example.id}: ${decoded.reason}`);
      assert.deepEqual(decoded.project.circuit.components, project.circuit.components);
      assert.deepEqual(decoded.project.circuit.wires, project.circuit.wires);
      assert.equal(decoded.project.title, project.title);
      assert.equal(decoded.project.settings.analysis, project.settings.analysis);
      assert.equal(decoded.method, compress ? "z" : "j");
    }
  }
});

test("auto는 더 짧은 형식을 고르고, 전체 URL·'p=' 형태 입력도 디코드", async () => {
  const project = projectOf(examples.find((item) => item.id === "opamp"));
  const auto = await encodeProjectToHash(project);
  assert.equal(auto.method, "z");
  const plain = await encodeProjectToHash(project, { compress: false });
  assert.ok(auto.length < plain.length);
  const url = buildShareUrl("https://example.test/circuit/?x=1#old", auto.hash);
  assert.equal(url.startsWith("https://example.test/circuit/?x=1#p=z."), true);
  assert.equal((await decodeProjectFromHash(url)).ok, true);
  assert.equal((await decodeProjectFromHash(auto.hash.slice(1))).ok, true);
  assert.equal((await decodeProjectFromHash(`${auto.hash}&other=1`)).ok, true);
  assert.equal(hasShareHash(url), true);
  assert.equal(hasShareHash("#something"), false);
  assert.equal(hasShareHash(""), false);
});

test("프로브 포함 프로젝트도 보존되고 검증된다", async () => {
  const project = projectOf(examples.find((item) => item.id === "divider"));
  project.probes = [{ key: "v2", kind: "voltage", componentId: "R2", pin: 0, label: "V(R2.1)", color: "#80bfff" }];
  const decoded = await decodeProjectFromHash((await encodeProjectToHash(project)).hash);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.project.probes, project.probes);
});

test("손상된 입력은 ok:false + 한국어 이유 (throw 없음)", async () => {
  const good = (await encodeProjectToHash(projectOf(examples[0]))).hash;
  const cases = [
    "", "#", "#p=", "#q=z.AAAA", "#p=x.AAAA", "#p=z.", "#p=j.",
    "#p=z.!!!!", "#p=z.a", "#p=j.@@@@",
    `${good.slice(0, -10)}`,                       // 잘림
    `${good.slice(0, 20)}AAAAAAAA${good.slice(28)}`, // 중간 변조
    `#p=z.${bytesToBase64Url(new TextEncoder().encode("not deflate data at all"))}`,
    `#p=j.${bytesToBase64Url(new TextEncoder().encode("{broken json"))}`,
    `#p=j.${bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ hello: "world" })))}`,
    `#p=j.${bytesToBase64Url(Uint8Array.from([0xff, 0xfe, 0xfd]))}`,                  // 잘못된 UTF-8
    `#p=j.${bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ format: "circuit-lab", version: 1, circuit: { version: 1, components: [{ id: "X", type: "NOPE" }], wires: [] } })))}`,
  ];
  for (const input of cases) {
    let result;
    await assert.doesNotReject(async () => { result = await decodeProjectFromHash(input); }, input);
    assert.equal(result.ok, false, `거부되어야 함: ${input.slice(0, 40)}`);
    assert.equal(typeof result.reason, "string");
    assert.match(result.reason, /[가-힣]/);
  }
  assert.equal((await decodeProjectFromHash(undefined)).ok, false);
});

test("압축 해제 크기 제한: 작은 압축 데이터가 200 KB 이상으로 풀리면 거부", async () => {
  const zeros = new Uint8Array(2 * 1024 * 1024);
  const stream = new Blob([zeros]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  assert.ok(packed.length < 20_000, "폭탄은 압축 후 작아야 한다");
  const result = await decodeProjectFromHash(`#p=z.${bytesToBase64Url(packed)}`);
  assert.equal(result.ok, false);
  assert.equal(result.reason, SHARE_TOO_LARGE_REASON);
});

test("일반(j) 형식 크기 제한과 사용자 지정 한도", async () => {
  const big = new Uint8Array(SHARE_MAX_DECODED_BYTES + 10).fill(0x20);
  const result = await decodeProjectFromHash(`#p=j.${bytesToBase64Url(big)}`);
  assert.equal(result.ok, false);
  assert.equal(result.reason, SHARE_TOO_LARGE_REASON);
  const small = await encodeProjectToHash(projectOf(examples[0]), { maxDecodedBytes: 100 });
  assert.deepEqual(small, { ok: false, reason: SHARE_TOO_LARGE_REASON });
});

function bigProject(count) {
  let seed = 12345;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const components = [{ id: "G1", type: "GND", x: 0, y: 0, rotation: 0, props: { ref: "GND" } }];
  const wires = [];
  for (let i = 1; i <= count; i += 1) {
    components.push({ id: `R${i}`, type: "R", x: Math.round(random() * 4000), y: Math.round(random() * 4000), rotation: 0, props: { ref: `R${i}`, value: `${(random() * 1000).toFixed(6)}k` } });
    wires.push({ id: `W${i}`, a: { componentId: `R${i}`, pin: 0 }, b: { componentId: "G1", pin: 0 } });
  }
  return { title: "큰 회로", subtitle: "", circuit: { version: 1, geometryVersion: 2, components, wires }, settings: { analysis: "dc" }, probes: [] };
}

test("링크 길이가 ~8000자를 넘으면 파일 저장 안내", async () => {
  const project = bigProject(250);
  const encoded = await encodeProjectToHash(project);
  assert.equal(encoded.ok, false);
  assert.equal(encoded.reason, "너무 커서 링크로 공유할 수 없습니다. 파일로 저장하세요.");
  const relaxed = await encodeProjectToHash(project, { maxUrlChars: 200_000 });
  assert.equal(relaxed.ok, true);
  const decoded = await decodeProjectFromHash(relaxed.hash);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.project.circuit.components.length, 251);
  const withBase = await encodeProjectToHash(projectOf(examples[0]), { baseHref: `https://example.test/${"a".repeat(9000)}` });
  assert.equal(withBase.ok, false, "기준 URL 길이도 포함해서 검사");
});

test("직렬화할 수 없는 프로젝트는 ok:false", async () => {
  const result = await encodeProjectToHash({ circuit: { components: "bad", wires: [] } });
  assert.equal(result.ok, false);
  assert.match(result.reason, /직렬화/);
});

// ---- 리뷰 회귀 테스트 ----
test("리뷰1: 압축 폭탄은 4 KB 입력 조각 단위로 넣다가 한도 초과 즉시 중단(전체 입력을 한 번에 넣지 않음)", async () => {
  const Original = globalThis.DecompressionStream;
  const writes = [];
  globalThis.DecompressionStream = class SpyDecompressionStream {
    constructor(format) {
      const inner = new Original(format);
      const innerWriter = inner.writable.getWriter();
      this.readable = inner.readable;
      this.writable = new WritableStream({
        write(chunk) { writes.push(chunk.length); return innerWriter.write(chunk); },
        close() { return innerWriter.close(); },
        abort(reason) { return innerWriter.abort(reason); },
      });
    }
  };
  try {
    // 무작위에 가까운 입력(압축 후 크기가 커지도록) + 거대한 0 구간 = 입력은 크고 일부 조각만 보면 한도 초과
    const zeros = new Uint8Array(16 * 1024 * 1024);
    const stream = new Blob([zeros]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    // 압축본 뒤에 조각을 더 붙여 입력을 키운다(첫 조각에서 이미 한도를 넘으므로 나머지는 쓰이면 안 된다)
    const padded = new Uint8Array(packed.length + 24_000);
    padded.set(packed);
    const totalSlices = Math.ceil(padded.length / 4096);
    assert.ok(totalSlices >= 8);
    const result = await decodeProjectFromHash(`#p=z.${bytesToBase64Url(padded)}`);
    assert.equal(result.ok, false);
    assert.equal(result.reason, SHARE_TOO_LARGE_REASON);
    assert.ok(writes.length >= 1);
    assert.ok(Math.max(...writes) <= 4096, `입력 조각 최대 ${Math.max(...writes)}바이트`);
    assert.ok(writes.length < totalSlices, `중단 없이 ${writes.length}/${totalSlices}조각을 모두 넣음`);
  } finally {
    globalThis.DecompressionStream = Original;
  }
});

test("리뷰1: 인코딩된 페이로드 길이 상한(해시 64 KB) 초과는 디코딩 전에 거부", async () => {
  const result = await decodeProjectFromHash(`#p=z.${"A".repeat(70_000)}`);
  assert.equal(result.ok, false);
  assert.equal(result.reason, SHARE_TOO_LARGE_REASON);
});

test("리뷰8: 유효한 해시 뒤에 '&' 100만 개 — 분할 없이 길이 상한으로 즉시 거부, hasShareHash는 #p= 접두사라 true(열기를 시도해 너무 커서 안내)", async () => {
  const good = (await encodeProjectToHash(projectOf(examples[0]))).hash;
  const huge = `${good}${"&".repeat(1_000_000)}`;
  const originalSplit = String.prototype.split;
  let splitCalls = 0;
  String.prototype.split = function patched(...args) { splitCalls += 1; return originalSplit.apply(this, args); };
  try {
    const started = performance.now();
    const result = await decodeProjectFromHash(huge);
    assert.equal(result.ok, false);
    assert.equal(result.reason, SHARE_TOO_LARGE_REASON);
    assert.equal(hasShareHash(huge), true);
    assert.equal(hasShareHash(`#a=1${"&".repeat(1_000_000)}`), false, "#p= 접두사가 아니면 거대한 해시는 스캔하지 않고 false");
    assert.equal(splitCalls, 0, "split을 쓰면 안 된다");
    assert.ok(performance.now() - started < 500);
  } finally {
    String.prototype.split = originalSplit;
  }
  // 상한 이내의 여러 파라미터는 여전히 동작
  assert.equal((await decodeProjectFromHash(`#a=1&&b=2&${good.slice(1)}&c=3`)).ok, true);
  assert.equal(hasShareHash("#a=1&&p=x&"), true);
  assert.equal(hasShareHash("#a=1&&"), false);
  assert.equal(hasShareHash("#p="), true, "비어 있어도 #p= 접두사면 true — 디코더가 이유를 보여 준다");
  assert.equal(hasShareHash(`#p=z.${"A".repeat(70_000)}`), true);
  assert.equal((await decodeProjectFromHash(`#p=z.${"A".repeat(70_000)}`)).reason, SHARE_TOO_LARGE_REASON);
  assert.equal(hasShareHash("https://example.test/?p=1"), false);
  assert.equal(hasShareHash(undefined), false);
});

test("리뷰9: 복원할 수 없는 입력('{}' 등)은 인코딩 단계에서 ok:false", async () => {
  for (const input of ["{}", "[]", "{\"format\":\"circuit-lab\"}", JSON.stringify({ hello: "world" })]) {
    const result = await encodeProjectToHash(input);
    assert.equal(result.ok, false, input);
    assert.match(result.reason, /복원할 수 없는/);
  }
  assert.equal((await encodeProjectToHash(projectOf(examples[0]))).ok, true);
});
