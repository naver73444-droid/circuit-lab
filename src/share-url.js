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

/** 해제 크기가 limit를 넘으면 즉시 중단(압축 폭탄 방지). */
async function inflateRaw(bytes, limit) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    chunks.push(value);
  }
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

function extractPayload(input) {
  if (typeof input !== "string") return null;
  const hashIndex = input.indexOf("#");
  const fragment = hashIndex >= 0 ? input.slice(hashIndex + 1) : input;
  for (const part of fragment.split("&")) {
    if (part.startsWith(`${SHARE_PARAM}=`)) return part.slice(SHARE_PARAM.length + 1);
  }
  return null;
}

/** 해시/URL에 공유 데이터가 들어 있는지(검증 없이). */
export function hasShareHash(input) {
  const payload = extractPayload(input);
  return payload !== null && payload.length > 0;
}

/**
 * 해시(또는 전체 URL) -> 프로젝트. 입력은 신뢰하지 않으며 기존 파서로 검증한다.
 * 성공: { ok:true, project, method } (project = deserializeProject 결과: {wrapped, circuit, settings, probes, title, subtitle})
 * 실패: { ok:false, reason }
 */
export async function decodeProjectFromHash(input, options = {}) {
  const { maxDecodedBytes = SHARE_MAX_DECODED_BYTES, fallbackSettings = {} } = options;
  const payload = extractPayload(input);
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
