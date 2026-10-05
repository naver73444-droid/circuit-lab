/**
 * Never-reused ids for new parts, junctions and wires (DOM 없음).
 *
 * Handing out "the first free number" lets a new part take the id of one that was just deleted, and then everything that still points at
 * the old id (a pasted current-controlled source whose control target was S1, a clipboard fragment, an undo snapshot read later) silently
 * binds to the unrelated newcomer. So an allocator remembers the highest number it ever issued per prefix and always continues above
 * it. The circuit that is already there seeds the count (every allocation also looks at the ids present), so a loaded project continues
 * after its largest id; deleting, undo and redo never lower it, because the memory lives here and not in the circuit.
 *
 * One allocator per project (state.projectId): a new, opened or restored-from-link project starts a new one, while undo/redo keep the
 * project id and therefore the allocator.
 */
const MAX_DIGITS = 9;
const MAX_NUMBER = 10 ** MAX_DIGITS - 1;

export function createIdAllocator() {
  const high = new Map(); // prefix -> highest number issued
  const numberIn = (id, prefix) => {
    if (typeof id !== "string" || !id.startsWith(prefix)) return 0;
    const digits = id.slice(prefix.length);
    return digits.length > 0 && digits.length <= MAX_DIGITS && /^\d+$/.test(digits) ? Number(digits) : 0;
  };
  return {
    /** The next id for `prefix`, above every number issued before and above every id in the given lists of {id} items. */
    next(prefix, ...lists) {
      let top = high.get(prefix) ?? 0;
      for (const list of lists) for (const item of list ?? []) top = Math.max(top, numberIn(item?.id, prefix));
      if (top >= MAX_NUMBER) throw new RangeError(`id space exhausted for ${prefix}`);
      high.set(prefix, top + 1);
      return `${prefix}${top + 1}`;
    },
    /**
     * Count the ids that exist right now (a loaded or edited circuit) as already used. The editor calls this before every edit, so an id that
     * was in the project is remembered even when the part is deleted before anything was ever allocated.
     */
    observe(...lists) {
      for (const list of lists) {
        for (const item of list ?? []) {
          const match = typeof item?.id === "string" ? /^([A-Za-z_]+)(\d{1,9})$/.exec(item.id) : null;
          if (match) high.set(match[1], Math.max(high.get(match[1]) ?? 0, Number(match[2])));
        }
      }
    },
    /** The highest number issued so far for `prefix` (0 when none). */
    highWater: (prefix) => high.get(prefix) ?? 0,
  };
}

const MAX_PROJECTS_REMEMBERED = 16;

/** The allocator of the project the editor state currently shows (created on first use, kept per project id). */
export function allocatorFor(state) {
  if (!(state.idAllocators instanceof Map)) state.idAllocators = new Map();
  const key = state.projectId ?? "";
  let allocator = state.idAllocators.get(key);
  if (!allocator) {
    allocator = createIdAllocator();
    // Only a few projects are open in one page session; forget the oldest so the table cannot grow without bound.
    if (state.idAllocators.size >= MAX_PROJECTS_REMEMBERED) state.idAllocators.delete(state.idAllocators.keys().next().value);
  } else {
    state.idAllocators.delete(key);
  }
  state.idAllocators.set(key, allocator); // most recently used last
  return allocator;
}
