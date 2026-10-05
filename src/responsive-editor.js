// Phone layout of the circuit editor header. Desktop keeps the full toolbar; at phone width the controls are
// regrouped (elements are moved, never recreated, so ids and event wiring stay intact):
//   row 1  title · undo · redo · help · "파일" menu (examples, new, save, open, AC course)
//   row 2  editing tools + delete
//   canvas corner  clone · rotate (only while a component is selected) · zoom out/in · fit
export const PHONE_QUERY = '(max-width: 899px)';

// [element id, mobile container id], in document order so the desktop layout can be restored exactly.
const MOVES = [
  ['undo-button', 'head-tools'], ['redo-button', 'head-tools'],
  ['clone-button', 'canvas-corner'], ['rotate-button', 'canvas-corner'], ['zoom-group', 'canvas-corner'],
  ['interaction-help', 'head-tools'],
];

export function initResponsiveEditor(doc = document, win = window) {
  if (typeof win.matchMedia !== 'function') return;
  const menu = doc.getElementById('file-menu');
  const slots = MOVES.map(([id, targetId]) => {
    const element = doc.getElementById(id), target = doc.getElementById(targetId);
    return element && target ? { element, target, parent: element.parentNode, next: element.nextSibling } : null;
  }).filter(Boolean);
  const query = win.matchMedia(PHONE_QUERY);
  const apply = () => {
    if (query.matches) {
      for (const { element, target } of slots) target.append(element);
      if (menu) menu.open = false;
    } else {
      for (const { element, parent, next } of [...slots].reverse()) parent.insertBefore(element, next?.parentNode === parent ? next : null);
      if (menu) menu.open = true;
    }
  };
  apply();
  query.addEventListener?.('change', apply);
  if (!menu) return;
  // The phone menu is a popover: it closes after a choice, on an outside tap and on Escape.
  menu.addEventListener('click', (event) => { if (query.matches && event.target.closest?.('button')) menu.open = false; });
  menu.addEventListener('change', (event) => { if (query.matches && event.target.matches?.('select')) menu.open = false; });
  doc.addEventListener('click', (event) => { if (query.matches && menu.open && !menu.contains(event.target)) menu.open = false; });
  doc.addEventListener('keydown', (event) => {
    if (query.matches && event.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary')?.focus(); }
  });
}
