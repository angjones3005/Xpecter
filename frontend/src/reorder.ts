// Reordering a list by dragging one row above or below another.
//
// The sidebar's sessions, session folders, pinned folders and shell
// profiles are stored as arrays, and the array order is the order on
// screen. Dragging changes that order and nothing else. What lives
// here is the arithmetic, kept out of main.ts so it can be tested; the
// drag events and the saving are main.ts's.

export type DropSide = 'before' | 'after';

// Which side of a row a pointer at y lands on: the top half puts the
// dragged row above it, the bottom half below.
export function dropSide(y: number, top: number, height: number): DropSide {
  return y < top + height / 2 ? 'before' : 'after';
}

// The ids in their new order once movedId sits beside targetId. A move
// onto itself, or one naming an id that is not in the list, changes
// nothing. Always a new array, so callers can compare.
export function reorderIds(ids: string[], movedId: string, targetId: string, side: DropSide): string[] {
  if (movedId === targetId || !ids.includes(movedId)) return ids.slice();
  const rest = ids.filter((id) => id !== movedId);
  const at = rest.indexOf(targetId);
  if (at < 0) return ids.slice();
  rest.splice(side === 'before' ? at : at + 1, 0, movedId);
  return rest;
}

// Whether making movedId a child of parentId would put a folder inside
// itself: the chain of parents above parentId is walked looking for
// movedId. A parent chain with a loop in it (a corrupt file) ends the
// walk rather than spinning.
export function wouldNest(parentOf: Map<string, string | undefined>, movedId: string, parentId: string | undefined): boolean {
  const seen = new Set<string>();
  let current = parentId;
  while (current) {
    if (current === movedId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = parentOf.get(current);
  }
  return false;
}
