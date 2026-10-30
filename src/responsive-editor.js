// Phone layout of the circuit editor header. Desktop keeps the full toolbar; at phone width the controls are
// regrouped (elements are moved, never recreated, so ids and event wiring stay intact):
//   row 1  title · help · "파일" menu (examples, new, save, open, AC course)
//   row 2  editing tools + delete
//   bottom tab bar (thumb reach, beside the panel tabs)  undo · redo — on screen whichever panel is scrolled to
//   canvas corner (lower right)  zoom out/in · fit
// Clone and rotate also move to the corner, but the phone shows them on the selection bar next to the part (canvas-actions.js), so the
// corner keeps them hidden (styles.css).
export const PHONE_QUERY = '(max-width: 899px)';
// A touch tablet held sideways (iPad landscape: 1180 × ~740 CSS px): the desktop grid, but the "파일" actions become the same popover
// as on the phone and the zoom controls sit in the canvas corner, so the editing tools fit on one row and the circuit keeps its height.
export const TABLET_QUERY = '(min-width: 900px) and (pointer: coarse)';

// [element id, container id] per layout, in document order so the desktop layout can be restored exactly.
const MOVES = [
  ['undo-button', 'tabbar-history'], ['redo-button', 'tabbar-history'],
  ['clone-button', 'canvas-corner'], ['rotate-button', 'canvas-corner'], ['zoom-group', 'canvas-corner'],
  ['interaction-help', 'head-tools'],
];
const TABLET_MOVES = [['zoom-group', 'canvas-corner']];

export function initResponsiveEditor(doc = document, win = window) {
  if (typeof win.matchMedia !== 'function') return;
  const menu = doc.getElementById('file-menu');
  const slotOf = ([id, targetId]) => {
    const element = doc.getElementById(id), target = doc.getElementById(targetId);
    return element && target ? { element, target, parent: element.parentNode, next: element.nextSibling } : null;
  };
  const slots = MOVES.map(slotOf).filter(Boolean), tabletIds = new Set(TABLET_MOVES.map(([id]) => id));
  const query = win.matchMedia(PHONE_QUERY), tablet = win.matchMedia(TABLET_QUERY);
  // Phone or touch tablet: the file actions are a popover that closes after a choice.
  const compact = () => query.matches || tablet.matches;
  const apply = () => {
    for (const { element, parent, next } of [...slots].reverse()) parent.insertBefore(element, next?.parentNode === parent ? next : null);
    if (query.matches) for (const { element, target } of slots) target.append(element);
    else if (tablet.matches) for (const { element, target } of slots) if (tabletIds.has(element.id)) target.append(element);
    if (menu) menu.open = !compact();
  };
  apply();
  query.addEventListener?.('change', apply);
  tablet.addEventListener?.('change', apply);
  // Phone: the circuit's description (an example's textbook answer, rms note) has no room beside the title; ⓘ unfolds it as a row
  // under the header. The desktop shows it inline, so the button is hidden there (styles.css).
  const caption = doc.getElementById('canvas-caption'), info = doc.getElementById('caption-info-button');
  info?.addEventListener('click', () => {
    const open = !caption.hasAttribute('data-open');
    caption.toggleAttribute('data-open', open);
    info.setAttribute('aria-expanded', String(open));
    info.setAttribute('aria-label', open ? '회로 설명 접기' : '회로 설명 보기');
  });
  if (!menu) return;
  // The phone menu is a popover: it closes after a choice, on an outside tap and on Escape.
  menu.addEventListener('click', (event) => { if (compact() && event.target.closest?.('button')) menu.open = false; });
  menu.addEventListener('change', (event) => { if (compact() && event.target.matches?.('select')) menu.open = false; });
  doc.addEventListener('click', (event) => { if (compact() && menu.open && !menu.contains(event.target)) menu.open = false; });
  doc.addEventListener('keydown', (event) => {
    if (compact() && event.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary')?.focus(); }
  });
}
