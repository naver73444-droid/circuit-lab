// Textbook-chapter navigation of the circuit course (Alexander & Sadiku 7e, Ch.9–13). Pure data and helpers: the controller keeps the state and storage,
// the view draws the two rows (chapter, then that chapter's items). kind/id are the experiment ids (circuit-course-registry.js) and tool ids (TOOL_TABS).
export const NAV_STORAGE_KEY = 'circuit-lab.circuit-course.nav';
// label: short tab text (fits a 390 px row of four); the full title shows as the tooltip and as the heading of the open screen.
export const CHAPTERS = Object.freeze([
  { id: 'ch9-10', short: 'Ch9–10', long: '페이저·임피던스', items: [
    { kind: 'experiment', id: 'phasor-wave', label: '페이저' }, { kind: 'experiment', id: 'impedance', label: 'RLC 회로' },
    { kind: 'tool', id: 'complex', label: '복소 계산' }, { kind: 'tool', id: 'y-delta', label: 'Y–Δ 변환' }] },
  { id: 'ch11', short: 'Ch11', long: '교류 전력', items: [
    { kind: 'experiment', id: 'power', label: '복소전력' }, { kind: 'experiment', id: 'correction', label: '역률 보상' },
    { kind: 'tool', id: 'loads', label: '부하 합성' }, { kind: 'tool', id: 'max-power', label: '최대전력' }] },
  { id: 'ch12', short: 'Ch12', long: '3상 회로', items: [
    { kind: 'experiment', id: 'three-phase', label: '균형 3상' }, { kind: 'tool', id: 'three-phase-ext', label: '3상 확장' }] },
  { id: 'ch13', short: 'Ch13', long: '자기결합', items: [
    { kind: 'tool', id: 'coupled', label: '결합 코일' }, { kind: 'tool', id: 'transformer', label: '변압기' }] },
  { id: 'mine', short: '내 문제', long: '', items: [{ kind: 'experiment', id: 'problem', label: '내 문제' }] }
]);
export const itemKey = (kind, id) => kind + ':' + id;
export const chapterById = id => CHAPTERS.find(c => c.id === id) ?? null;
export const chapterOf = (kind, id) => CHAPTERS.find(c => c.items.some(i => i.kind === kind && i.id === id)) ?? null;
/** 'tool:loads' → the item definition, or null for anything that is not in the table. */
export const itemOfKey = key => CHAPTERS.flatMap(c => c.items).find(i => itemKey(i.kind, i.id) === key) ?? null;
/** The item shown for a chapter: the one chosen last in it, else its first. */
export function currentItem(nav) {
  const chapter = chapterById(nav.chapter) ?? CHAPTERS[0], last = itemOfKey(nav.last[chapter.id]);
  return last && chapterOf(last.kind, last.id) === chapter ? last : chapter.items[0];
}
export const initialNav = () => ({ chapter: CHAPTERS[0].id, last: {} });
/** The same state with one item chosen (and its chapter made current). Unknown items leave the state unchanged. */
export function selectItem(nav, kind, id) {
  const chapter = chapterOf(kind, id);
  return chapter ? { chapter: chapter.id, last: { ...nav.last, [chapter.id]: itemKey(kind, id) } } : nav;
}
/** The same state with another chapter current; it opens on the item last used there. */
export const selectChapter = (nav, chapterId) => (chapterById(chapterId) ? { ...nav, chapter: chapterId } : nav);
export const serializeNav = nav => JSON.stringify({ chapter: nav.chapter, last: nav.last });
/** Stored text → a valid state; anything unreadable or no longer in the table falls back to the defaults (never throws). */
export function parseNav(text) {
  const fresh = initialNav();
  let raw;
  try { raw = JSON.parse(text); } catch { return fresh; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fresh;
  const last = {};
  if (raw.last && typeof raw.last === 'object') for (const chapter of CHAPTERS) {
    const item = itemOfKey(raw.last[chapter.id]);
    if (item && chapterOf(item.kind, item.id) === chapter) last[chapter.id] = itemKey(item.kind, item.id);
  }
  return { chapter: chapterById(raw.chapter) ? raw.chapter : fresh.chapter, last };
}
