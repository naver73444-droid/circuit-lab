/**
 * 회로 편집기 자동 저장 모델 (DOM 없음, import 시 부작용 없음).
 *
 * 탭마다 자기 슬롯 하나에만 쓴다: storage["circuit-lab.autosave.v2.<tabId>"] = JSON {"v":2,"tabId","savedAt":<ms>,"project":<serializeProject 결과를 파싱한 객체>}.
 * tabId는 sessionStorage에 있어 같은 탭의 새로고침에서는 유지되고 새 탭은 새 id를 받는다. 슬롯은 최대 5개이며 쓸 때 savedAt이 가장 오래된 것부터 지운다.
 * 다른 탭의 작업은 이 탭이 절대 덮어쓰지 않는다. 예전 단일 키(v1)는 처음 실행할 때 새 id의 슬롯으로 옮긴다.
 * schedule()은 호출 순간에 직렬화해 사본(스냅샷)을 보관하므로, 이후 살아 있는 객체가 바뀌어도(드래그 중 좌표 등) 저장 내용에 새지 않는다.
 * "invalid-skip": 현재 프로젝트가 복원 파서(parse)를 통과하지 못해(편집 도중 등) 저장하지 않고 이전 저장본을 그대로 둔 상태.
 * 저장소(storage) 오류(용량 초과·사생활 보호 모드·접근 거부)는 절대 throw하지 않고 상태 객체로 돌려주며, 모든 쓰기 결과는 onResult로도 알린다.
 *
 * 상태 객체: { ok:boolean, state:"saved"|"pending"|"cleared"|"empty"|"unavailable"|"quota"|"error"|"invalid"|"invalid-skip", reason?:string, savedAt?:number }
 */
import { deserializeProject, serializeProject } from "./project-format.js";

export const AUTOSAVE_PREFIX = "circuit-lab.autosave.v2.";
export const LEGACY_AUTOSAVE_KEY = "circuit-lab.autosave.v1";
export const TAB_ID_KEY = "circuit-lab.tab-id";
export const AUTOSAVE_VERSION = 2;
export const AUTOSAVE_MAX_SLOTS = 5;
export const AUTOSAVE_MAX_CHARS = 4_000_000;

const REASONS = {
  unavailable: "브라우저 저장소를 사용할 수 없어 자동 저장하지 않습니다.",
  quota: "브라우저 저장 공간이 부족해 자동 저장하지 못했습니다. 파일로 저장하세요.",
  error: "자동 저장에 실패했습니다.",
  invalidSkip: "현재 편집 중인 내용이 아직 올바르지 않아 자동 저장을 건너뛰었습니다(이전 저장본은 그대로입니다).",
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

const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

function randomId() {
  try {
    const id = globalThis.crypto?.randomUUID?.();
    if (id) return id;
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createAutosave({
  storage,
  session,
  tabId: fixedTabId,
  prefix = AUTOSAVE_PREFIX,
  legacyKey = LEGACY_AUTOSAVE_KEY,
  maxSlots = AUTOSAVE_MAX_SLOTS,
  serialize = serializeProject,
  parse = deserializeProject,
  debounceMs = 800,
  now = () => Date.now(),
  newId = randomId,
  onResult = null,
  setTimeout: setTimer = (...args) => globalThis.setTimeout(...args),
  clearTimeout: clearTimer = (...args) => globalThis.clearTimeout(...args),
} = {}) {
  let resolved = storage;
  let timer = null;
  let pending = null; // snapshot object taken at schedule() time (never the live project)
  let hasPending = false;
  let lastStatus = status("empty");

  function getStorage() {
    if (resolved !== undefined) return resolved;
    try { resolved = globalThis.localStorage ?? null; } catch { resolved = null; }
    return resolved;
  }

  /** This tab's id: kept in sessionStorage (survives a reload of the same tab, a new tab gets a new one). */
  function resolveTabId() {
    if (fixedTabId) return fixedTabId;
    let tabSession = session;
    if (tabSession === undefined) { try { tabSession = globalThis.sessionStorage ?? null; } catch { tabSession = null; } }
    try {
      const stored = tabSession?.getItem(TAB_ID_KEY);
      if (typeof stored === "string" && ID_PATTERN.test(stored)) return stored;
    } catch { /* unavailable: fall back to a per-load id */ }
    const id = newId();
    try { tabSession?.setItem(TAB_ID_KEY, id); } catch { /* the id then lives only for this page load */ }
    return id;
  }
  const tabId = resolveTabId();
  const ownKey = prefix + tabId;

  function record(next) {
    lastStatus = next;
    return next;
  }

  /** Record a write outcome and tell the owner (timer-driven results have nobody else to hear them). */
  function report(next) {
    record(next);
    try { onResult?.(next); } catch { /* an observer must not break saving */ }
    return next;
  }

  function cancelTimer() {
    if (timer !== null) { try { clearTimer(timer); } catch { /* ignore */ } timer = null; }
  }

  // ---- slots

  function slotKeys(target) {
    const keys = [];
    const count = target.length;
    for (let index = 0; index < count; index += 1) {
      const key = target.key(index);
      if (typeof key === "string" && key.startsWith(prefix)) keys.push(key);
    }
    return keys;
  }

  /** Every slot: {key, tabId, savedAt:number|null, entry|null}. entry is null when the stored value is unreadable. */
  function readSlots(target) {
    return slotKeys(target).map((key) => {
      let entry = null;
      try {
        const parsed = JSON.parse(target.getItem(key));
        if (parsed && typeof parsed === "object" && parsed.v === AUTOSAVE_VERSION && parsed.project && typeof parsed.project === "object") entry = parsed;
      } catch { /* unreadable slot */ }
      return { key, tabId: key.slice(prefix.length), savedAt: Number.isFinite(entry?.savedAt) ? entry.savedAt : null, entry };
    });
  }

  const newestFirst = (a, b) => (b.savedAt ?? -Infinity) - (a.savedAt ?? -Infinity) || (a.key === ownKey ? -1 : b.key === ownKey ? 1 : 0) || (a.key < b.key ? -1 : 1);

  /** Keep at most maxSlots slots: the oldest (by savedAt, unreadable first) other than this tab's own are removed. */
  function prune(target) {
    const slots = readSlots(target);
    let excess = slots.length - maxSlots;
    if (excess <= 0) return;
    for (const slot of slots.filter((item) => item.key !== ownKey).sort((a, b) => newestFirst(b, a))) {
      if (excess <= 0) break;
      target.removeItem(slot.key);
      excess -= 1;
    }
  }

  /** The v1 single key becomes a slot with a fresh id (kept until the copy succeeded, so nothing is lost on a failed write). */
  function migrateLegacy() {
    const target = getStorage();
    if (!target || typeof target.getItem !== "function" || typeof target.setItem !== "function" || typeof target.removeItem !== "function") return false;
    try {
      const raw = target.getItem(legacyKey);
      if (raw === null || raw === undefined) return false;
      let entry = null;
      try { entry = JSON.parse(raw); } catch { /* unreadable: just drop it below */ }
      const valid = Boolean(entry) && typeof entry === "object" && entry.v === 1 && entry.project && typeof entry.project === "object";
      if (valid) {
        const id = newId();
        const savedAt = Number.isFinite(entry.savedAt) ? entry.savedAt : now();
        target.setItem(prefix + id, JSON.stringify({ v: AUTOSAVE_VERSION, tabId: id, savedAt, project: entry.project }));
      }
      target.removeItem(legacyKey);
      try { prune(target); } catch { /* best effort */ }
      return valid;
    } catch {
      return false; // the old key stays and is tried again on the next start
    }
  }
  migrateLegacy();

  // ---- writing

  function snapshotOf(project) {
    try {
      const text = serialize(project);
      const object = JSON.parse(typeof text === "string" ? text : JSON.stringify(text));
      try {
        parse(JSON.stringify(object), {}); // 복원할 수 없는 내용으로 좋은 저장본을 덮어쓰지 않는다
      } catch (error) {
        return { result: status("invalid-skip", { reason: `${REASONS.invalidSkip} (${error?.message ?? error})` }) };
      }
      return { object };
    } catch (error) {
      // 편집 도중 구조가 잠시 유효하지 않으면 직렬화가 던질 수 있다 — 이전 저장본은 그대로 둔다.
      return { result: status("invalid-skip", { reason: `${REASONS.invalidSkip} (${error?.message ?? error})` }) };
    }
  }

  function write(object) {
    const target = getStorage();
    if (!target || typeof target.setItem !== "function") return status("unavailable", { reason: REASONS.unavailable });
    try {
      const savedAt = now();
      const payload = JSON.stringify({ v: AUTOSAVE_VERSION, tabId, savedAt, project: object });
      if (payload.length > AUTOSAVE_MAX_CHARS) return status("error", { reason: REASONS.tooLarge });
      target.setItem(ownKey, payload);
      try { prune(target); } catch { /* a failed prune must not turn a good save into an error */ }
      return status("saved", { savedAt });
    } catch (error) {
      if (isQuotaError(error)) return status("quota", { reason: REASONS.quota });
      return status("error", { reason: `${REASONS.error} (${error?.message ?? error})` });
    }
  }

  function flush() {
    cancelTimer();
    if (!hasPending) return lastStatus;
    // 쓰기에 성공했을 때만 대기 항목을 비운다(용량 초과 등으로 실패하면 다음 flush()에서 다시 시도).
    const result = report(write(pending));
    if (result.state === "saved") { hasPending = false; pending = null; }
    return result;
  }

  // ---- reading

  /**
   * 상세 결과: {ok:true, project, savedAt, tabId, own} | {ok:false, empty:boolean, reason} — 절대 throw하지 않음.
   * current(프로젝트)를 주면 그와 내용이 다른 가장 최근 슬롯만 후보가 된다(이 탭의 슬롯이 불러온 내용과 같으면 건너뜀).
   */
  function loadDetailed(fallbackSettings = {}, { current } = {}) {
    const target = getStorage();
    if (!target || typeof target.getItem !== "function" || typeof target.key !== "function") return { ok: false, empty: false, reason: REASONS.unavailable };
    let slots;
    try { slots = readSlots(target); } catch { return { ok: false, empty: false, reason: REASONS.unavailable }; }
    if (!slots.length) return { ok: false, empty: true, reason: "저장된 작업이 없습니다." };
    const readable = slots.filter((slot) => slot.entry).sort(newestFirst);
    if (!readable.length) return { ok: false, empty: false, reason: "지원하지 않는 자동 저장 형식입니다." };
    let failure = null;
    for (const slot of readable) {
      let project;
      try { project = parse(JSON.stringify(slot.entry.project), fallbackSettings); } catch (error) { failure ??= `저장된 작업이 올바르지 않습니다: ${error?.message ?? error}`; continue; }
      const candidate = { project, savedAt: slot.savedAt, tabId: slot.tabId, own: slot.key === ownKey };
      if (current !== undefined && !shouldOfferRestore(candidate, current)) continue;
      return { ok: true, ...candidate };
    }
    return failure ? { ok: false, empty: false, reason: failure } : { ok: false, empty: true, reason: "복원할 다른 작업이 없습니다." };
  }

  /** {project, savedAt} | null (가장 최근 슬롯). 실패 이유는 getStatus().reason 에서 읽는다. */
  function load(fallbackSettings = {}) {
    const result = loadDetailed(fallbackSettings);
    if (result.ok) {
      record(status("saved", { savedAt: result.savedAt }));
      return { project: result.project, savedAt: result.savedAt };
    }
    record(result.empty ? status("empty", { reason: result.reason }) : status("invalid", { reason: result.reason }));
    return null;
  }

  return {
    /** 호출 순간의 프로젝트를 사본으로 보관하고, 마지막 호출 후 debounceMs가 지나면 이 탭의 슬롯에 저장한다. */
    schedule(project) {
      const snapshot = snapshotOf(project);
      if (!snapshot.object) return report(snapshot.result); // 이미 대기 중인 올바른 사본이 있으면 그대로 둔다
      pending = snapshot.object;
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
    /** 대기 중인 저장만 버린다(프로젝트를 통째로 바꾸기 전에). 저장된 슬롯은 건드리지 않는다. */
    cancel() {
      cancelTimer();
      hasPending = false;
      pending = null;
      if (lastStatus.state === "pending") record(status("empty"));
    },
    /** 대기 중인 저장을 취소하고 이 탭의 슬롯을 지운다. */
    clear() {
      cancelTimer();
      hasPending = false;
      pending = null;
      const target = getStorage();
      if (!target || typeof target.removeItem !== "function") return record(status("unavailable", { reason: REASONS.unavailable }));
      try {
        target.removeItem(ownKey);
        return record(status("cleared"));
      } catch (error) {
        return record(status("error", { reason: `${REASONS.error} (${error?.message ?? error})` }));
      }
    },
    loadDetailed,
    load,
    /** 읽을 수 있는 슬롯 요약(최근 순): [{tabId, savedAt, own}] */
    listSlots() {
      const target = getStorage();
      if (!target || typeof target.key !== "function") return [];
      try { return readSlots(target).filter((slot) => slot.entry).sort(newestFirst).map((slot) => ({ tabId: slot.tabId, savedAt: slot.savedAt, own: slot.key === ownKey })); } catch { return []; }
    },
    getStatus() { return lastStatus; },
    hasPending() { return hasPending; },
    tabId,
    key: ownKey,
  };
}
