/**
 * 회로 편집기 자동 저장 모델 (DOM 없음, import 시 부작용 없음).
 *
 * 저장 형식(storage[key]): JSON {"v":1,"savedAt":<ms>,"project":<serializeProject 결과를 파싱한 객체>}
 * 저장소(storage) 오류(용량 초과·사생활 보호 모드·접근 거부)는 절대 throw하지 않고 상태 객체로 돌려준다.
 *
 * 상태 객체: { ok:boolean, state:"saved"|"pending"|"cleared"|"empty"|"unavailable"|"quota"|"error"|"invalid", reason?:string, savedAt?:number }
 */
import { deserializeProject, serializeProject } from "./project-format.js";

export const AUTOSAVE_KEY = "circuit-lab.autosave.v1";
export const AUTOSAVE_VERSION = 1;
export const AUTOSAVE_MAX_CHARS = 4_000_000;

const REASONS = {
  unavailable: "브라우저 저장소를 사용할 수 없어 자동 저장하지 않습니다.",
  quota: "브라우저 저장 공간이 부족해 자동 저장하지 못했습니다. 파일로 저장하세요.",
  error: "자동 저장에 실패했습니다.",
  tooLarge: "프로젝트가 너무 커서 자동 저장하지 못했습니다. 파일로 저장하세요.",
};

function isQuotaError(error) {
  return Boolean(error) && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED" || error.code === 22 || error.code === 1014);
}

function status(state, extra = {}) {
  return { ok: ["saved", "pending", "cleared", "empty"].includes(state), state, ...extra };
}

/** 컴포넌트·배선·정션이 모두 없으면 빈 프로젝트. 직렬화된 형태와 편집기 형태 모두 허용. */
export function isEmptyProject(project) {
  const circuit = project?.circuit ?? project;
  if (!circuit || typeof circuit !== "object") return true;
  return !(circuit.components?.length || circuit.wires?.length || circuit.junctions?.length);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 회로 내용 + 프로브 + 제목 기준의 비교용 지문. (분석 설정·fallback 설정 차이는 무시) */
export function projectFingerprint(project) {
  const circuit = project?.circuit ?? {};
  return stableStringify({
    circuit: { geometryVersion: circuit.geometryVersion, components: circuit.components ?? [], wires: circuit.wires ?? [], junctions: circuit.junctions ?? [] },
    probes: project?.probes ?? [],
    title: project?.title ?? null,
    subtitle: project?.subtitle ?? null,
  });
}

/**
 * 복원 제안 여부.
 *   saved: load()의 결과 {project, savedAt} 또는 null
 *   current: boolean(현재 편집기가 비어 있는지) 또는 현재 프로젝트 객체
 * - 저장본이 없거나 비어 있으면 false
 * - current === true  -> true
 * - current === false -> false (현재 작업을 덮어쓸 수 있으므로 보수적으로 제안하지 않음)
 * - current가 프로젝트 객체 -> 비어 있으면 true, 아니면 저장본과 내용이 다를 때만 true
 */
export function shouldOfferRestore(saved, current) {
  if (!saved?.project || isEmptyProject(saved.project)) return false;
  if (current === true) return true;
  if (current === false || current === undefined || current === null) return false;
  if (isEmptyProject(current)) return true;
  return projectFingerprint(saved.project) !== projectFingerprint(current);
}

/** "3분 전" 같은 한국어 경과 시간. */
export function describeSavedAt(savedAt, now = Date.now()) {
  if (!Number.isFinite(savedAt)) return "저장 시각 알 수 없음";
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 45) return "방금 전";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}

export function createAutosave({
  storage,
  key = AUTOSAVE_KEY,
  serialize = serializeProject,
  parse = deserializeProject,
  debounceMs = 800,
  now = () => Date.now(),
  setTimeout: setTimer = (...args) => globalThis.setTimeout(...args),
  clearTimeout: clearTimer = (...args) => globalThis.clearTimeout(...args),
} = {}) {
  let resolved = storage;
  let timer = null;
  let pendingProject = null;
  let hasPending = false;
  let lastStatus = status("empty");

  function getStorage() {
    if (resolved !== undefined) return resolved;
    try { resolved = globalThis.localStorage ?? null; } catch { resolved = null; }
    return resolved;
  }

  function record(next) {
    lastStatus = next;
    return next;
  }

  function cancelTimer() {
    if (timer !== null) { try { clearTimer(timer); } catch { /* ignore */ } timer = null; }
  }

  function write(project) {
    const target = getStorage();
    if (!target || typeof target.setItem !== "function") return record(status("unavailable", { reason: REASONS.unavailable }));
    let payload;
    try {
      const text = serialize(project);
      const object = typeof text === "string" ? JSON.parse(text) : text;
      const savedAt = now();
      payload = JSON.stringify({ v: AUTOSAVE_VERSION, savedAt, project: object });
      if (payload.length > AUTOSAVE_MAX_CHARS) return record(status("error", { reason: REASONS.tooLarge }));
      target.setItem(key, payload);
      return record(status("saved", { savedAt }));
    } catch (error) {
      if (isQuotaError(error)) return record(status("quota", { reason: REASONS.quota }));
      // 편집 도중 구조가 잠시 유효하지 않으면 직렬화가 던질 수 있다 — 이전 저장본은 그대로 둔다.
      return record(status("error", { reason: `${REASONS.error} (${error?.message ?? error})` }));
    }
  }

  function flush() {
    cancelTimer();
    if (!hasPending) return lastStatus;
    const project = pendingProject;
    hasPending = false;
    pendingProject = null;
    return write(project);
  }

  return {
    /** 마지막 호출 후 debounceMs가 지나면 저장. 직렬화는 저장 시점에 하므로 최신 상태가 저장된다. */
    schedule(project) {
      pendingProject = project;
      hasPending = true;
      cancelTimer();
      try {
        timer = setTimer(() => { timer = null; flush(); }, debounceMs);
      } catch {
        return flush();
      }
      return record(status("pending"));
    },
    flush,
    /** 대기 중인 저장을 취소하고 저장본을 지운다. */
    clear() {
      cancelTimer();
      hasPending = false;
      pendingProject = null;
      const target = getStorage();
      if (!target || typeof target.removeItem !== "function") return record(status("unavailable", { reason: REASONS.unavailable }));
      try {
        target.removeItem(key);
        return record(status("cleared"));
      } catch (error) {
        return record(status("error", { reason: `${REASONS.error} (${error?.message ?? error})` }));
      }
    },
    loadDetailed,
    /** {project, savedAt} | null. 실패 이유는 getStatus().reason 에서 읽는다. */
    load,
    getStatus() { return lastStatus; },
    hasPending() { return hasPending; },
  };

  /** 상세 결과: {ok:true, project, savedAt} | {ok:false, empty:boolean, reason} — 절대 throw하지 않음. */
  function loadDetailed(fallbackSettings = {}) {
      const target = getStorage();
      if (!target || typeof target.getItem !== "function") return { ok: false, empty: false, reason: REASONS.unavailable };
      let raw;
      try { raw = target.getItem(key); } catch { return { ok: false, empty: false, reason: REASONS.unavailable }; }
      if (raw === null || raw === undefined) return { ok: false, empty: true, reason: "저장된 작업이 없습니다." };
      let entry;
      try { entry = JSON.parse(raw); } catch { return { ok: false, empty: false, reason: "저장된 작업 데이터를 읽을 수 없습니다." }; }
      if (!entry || typeof entry !== "object" || entry.v !== AUTOSAVE_VERSION || !entry.project || typeof entry.project !== "object") {
        return { ok: false, empty: false, reason: "지원하지 않는 자동 저장 형식입니다." };
      }
      const savedAt = Number.isFinite(entry.savedAt) ? entry.savedAt : null;
      try {
        const project = parse(JSON.stringify(entry.project), fallbackSettings);
        return { ok: true, project, savedAt };
      } catch (error) {
        return { ok: false, empty: false, reason: `저장된 작업이 올바르지 않습니다: ${error?.message ?? error}` };
      }
  }

  /** {project, savedAt} | null. 실패 이유는 getStatus().reason 에서 읽는다. */
  function load(fallbackSettings = {}) {
    const result = loadDetailed(fallbackSettings);
    if (result.ok) {
      record(status("saved", { savedAt: result.savedAt }));
      return { project: result.project, savedAt: result.savedAt };
    }
    record(result.empty ? status("empty", { reason: result.reason }) : status("invalid", { reason: result.reason }));
    return null;
  }
}
