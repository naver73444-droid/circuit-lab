/**
 * 프로젝트를 URL 해시(#p=<접두사>.<base64url>)로 인코딩/디코딩하는 모델. DOM 없음.
 *   #p=z.<base64url(deflate-raw(UTF-8 JSON))>   (CompressionStream 사용 가능할 때)
 *   #p=j.<base64url(UTF-8 JSON)>                (압축 없는 대체 형식)
 * 디코딩은 반드시 기존 파서(deserializeProject)로 검증하고, 압축 해제 크기를 제한한다.
 */
import { deserializeProject, serializeProject } from "./project-format.js";

export const SHARE_PARAM = "p";
export const SHARE_MAX_DECODED_BYTES = 200 * 1024;
export const SHARE_MAX_URL_CHARS = 8000;
/** 해시(# 뒤) 전체 길이 상한. 이보다 길면 분할·디코딩 없이 거부한다. */
export const SHARE_MAX_HASH_CHARS = 64 * 1024;
/** 압축 해제기에 한 번에 넣는 입력 조각 크기(압축 폭탄이 한 번에 부풀 수 있는 양을 제한). */
export const SHARE_INFLATE_SLICE_BYTES = 4096;
export const SHARE_TOO_LARGE_REASON = "너무 커서 링크로 공유할 수 없습니다. 파일로 저장하세요.";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function bytesToBase64Url(bytes) {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63];
  }
  return out;
}

/** 잘못된 문자·길이면 null. 패딩(=)은 허용하지 않는다. */
export function base64UrlToBytes(text) {
  if (typeof text !== "string" || text.length % 4 === 1) return null;
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let out = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? LOOKUP[code] : -1;
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes[out++] = (buffer >> bits) & 255; buffer &= (1 << bits) - 1; }
  }
  return bytes.subarray(0, out);
}

export function compressionSupported() {
  return typeof CompressionStream === "function" && typeof DecompressionStream === "function" && typeof Blob === "function" && typeof Response === "function";
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * 압축을 풀되, 입력을 작은 조각(SHARE_INFLATE_SLICE_BYTES)으로 나눠 넣고 조각마다 누적 출력 크기를 확인한다.
 * 출력이 limit를 넘으면 다음 조각을 넣지 않고 즉시 중단(압축 폭탄 방지)하며 null을 돌려준다.
 * 손상된 데이터는 throw.
 */
async function inflateRaw(bytes, limit) {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  let exceeded = false;
  let readError = null;
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        total += value.length;
        if (total > limit) {
          exceeded = true;
          writer.abort(new Error("limit")).catch(() => {}); // 막혀 있는 write도 풀어 준다
          try { await reader.cancel(); } catch { /* ignore */ }
          return;
        }
        chunks.push(value);
      }
    } catch (error) {
      readError = error;
    }
  })();
  let writeError = null;
  try {
    for (let offset = 0; offset < bytes.length && !exceeded; offset += SHARE_INFLATE_SLICE_BYTES) {
      await writer.write(bytes.subarray(offset, offset + SHARE_INFLATE_SLICE_BYTES));
      await Promise.resolve(); // 읽기 쪽이 방금 나온 출력을 집계할 기회를 준다
      await Promise.resolve();
    }
    if (!exceeded) await writer.close();
  } catch (error) {
    writeError = error;
  }
  await pump;
  if (exceeded) return null;
  if (writeError || readError) throw writeError ?? readError;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

function minifiedProjectJson(project) {
  const text = typeof project === "string" ? project : serializeProject(project);
  return JSON.stringify(JSON.parse(text));
}

/**
 * 프로젝트 -> 해시 문자열.
 *   options: { compress: "auto"(기본)|true|false, maxDecodedBytes, maxUrlChars, baseHref("" 이면 해시 길이만 검사) }
 * 성공: { ok:true, hash:"#p=z.…", method:"z"|"j", length:<해시 문자 수>, urlLength, jsonBytes }
 * 실패: { ok:false, reason }
 */
export async function encodeProjectToHash(project, options = {}) {
  const { compress = "auto", maxDecodedBytes = SHARE_MAX_DECODED_BYTES, maxUrlChars = SHARE_MAX_URL_CHARS, baseHref = "" } = options;
  let json;
  try {
    json = minifiedProjectJson(project);
  } catch (error) {
    return { ok: false, reason: `프로젝트를 직렬화할 수 없습니다: ${error?.message ?? error}` };
  }
  try {
    deserializeProject(json); // 복원할 수 없는 입력은 링크로 만들지 않는다
  } catch (error) {
    return { ok: false, reason: `복원할 수 없는 프로젝트라 링크로 공유할 수 없습니다: ${error?.message ?? error}` };
  }
  const raw = new TextEncoder().encode(json);
  if (raw.length > maxDecodedBytes) return { ok: false, reason: SHARE_TOO_LARGE_REASON };
  const plain = `#${SHARE_PARAM}=j.${bytesToBase64Url(raw)}`;
  let best = { hash: plain, method: "j" };
  if (compress !== false && compressionSupported()) {
    try {
      const packed = `#${SHARE_PARAM}=z.${bytesToBase64Url(await deflateRaw(raw))}`;
      if (compress === true || packed.length < plain.length) best = { hash: packed, method: "z" };
    } catch { /* 압축 실패 시 일반 형식 */ }
  }
  const base = String(baseHref).split("#")[0];
  const urlLength = base.length + best.hash.length;
  if (urlLength > maxUrlChars) return { ok: false, reason: SHARE_TOO_LARGE_REASON, urlLength };
  return { ok: true, hash: best.hash, method: best.method, length: best.hash.length, urlLength, jsonBytes: raw.length };
}

/** 현재 href(해시 포함 가능)와 해시로 공유 URL을 만든다. */
export function buildShareUrl(baseHref, hash) {
  return `${String(baseHref).split("#")[0]}${hash}`;
}

/**
 * 해시(또는 전체 URL)에서 p= 값을 찾는다. 분할(split) 없이 '&' 위치만 훑는다.
 * 반환: {payload:string|null, tooLarge:boolean}. 해시 길이가 maxHashChars를 넘으면 스캔 전에 tooLarge.
 */
function extractPayload(input, maxHashChars = SHARE_MAX_HASH_CHARS) {
  if (typeof input !== "string") return { payload: null, tooLarge: false };
  const hashIndex = input.indexOf("#");
  const start = hashIndex >= 0 ? hashIndex + 1 : 0;
  if (input.length - start > maxHashChars) return { payload: null, tooLarge: true };
  const prefix = `${SHARE_PARAM}=`;
  let from = start;
  while (from <= input.length) {
    let end = input.indexOf("&", from);
    if (end < 0) end = input.length;
    if (input.startsWith(prefix, from)) return { payload: input.slice(from + prefix.length, end), tooLarge: false };
    from = end + 1;
  }
  return { payload: null, tooLarge: false };
}

/** 해시/URL에 공유 데이터가 들어 있는지(검증 없이). 해시가 SHARE_MAX_HASH_CHARS를 넘으면 false. */
export function hasShareHash(input) {
  const { payload } = extractPayload(input);
  return payload !== null && payload.length > 0;
}

/**
 * 해시(또는 전체 URL) -> 프로젝트. 입력은 신뢰하지 않으며 기존 파서로 검증한다.
 * 성공: { ok:true, project, method } (project = deserializeProject 결과: {wrapped, circuit, settings, probes, title, subtitle})
 * 실패: { ok:false, reason }
 */
export async function decodeProjectFromHash(input, options = {}) {
  const { maxDecodedBytes = SHARE_MAX_DECODED_BYTES, fallbackSettings = {}, maxHashChars = SHARE_MAX_HASH_CHARS } = options;
  const { payload, tooLarge } = extractPayload(input, maxHashChars);
  if (tooLarge) return { ok: false, reason: SHARE_TOO_LARGE_REASON };
  if (payload === null || payload.length === 0) return { ok: false, reason: "공유 링크에 프로젝트 데이터가 없습니다." };
  const method = payload.slice(0, 2);
  if (method !== "z." && method !== "j.") return { ok: false, reason: "지원하지 않는 공유 링크 형식입니다." };
  const body = payload.slice(2);
  // 대략적인 크기 사전 검사(디코딩 전)
  if (method === "j." && Math.floor((body.length * 3) / 4) > maxDecodedBytes) return { ok: false, reason: SHARE_TOO_LARGE_REASON };
  if (method === "z." && body.length > 4 * maxDecodedBytes) return { ok: false, reason: SHARE_TOO_LARGE_REASON };
  const bytes = base64UrlToBytes(body);
  if (!bytes || bytes.length === 0) return { ok: false, reason: "공유 링크가 손상되었습니다." };
  let raw = bytes;
  if (method === "z.") {
    if (!compressionSupported()) return { ok: false, reason: "이 브라우저는 압축된 공유 링크를 열 수 없습니다." };
    try {
      raw = await inflateRaw(bytes, maxDecodedBytes);
    } catch {
      return { ok: false, reason: "공유 링크가 손상되었습니다." };
    }
    if (raw === null) return { ok: false, reason: SHARE_TOO_LARGE_REASON };
  }
  if (raw.length > maxDecodedBytes) return { ok: false, reason: SHARE_TOO_LARGE_REASON };
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return { ok: false, reason: "공유 링크가 손상되었습니다." };
  }
  try {
    const project = deserializeProject(text, fallbackSettings);
    return { ok: true, project, method: method[0] };
  } catch (error) {
    return { ok: false, reason: `공유 링크의 회로 데이터가 올바르지 않습니다: ${error?.message ?? error}` };
  }
}
