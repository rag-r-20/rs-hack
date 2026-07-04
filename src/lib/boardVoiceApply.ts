import { syncComponentGrid } from "./diagram";
import type { BoardVoiceItem, PanelComponent } from "./types";

export function clampGridPos(n: number, max: number): number {
  return Math.max(1, Math.min(Math.floor(n), max));
}

/** Resolve duplicate (row, col) by moving unpinned tiles to the next free cell. */
export function resolveGridCollisions(
  components: PanelComponent[],
  rows: number,
  cols: number,
  pinnedIds: Set<string>,
): PanelComponent[] {
  const next = components.map((c) => ({ ...c }));
  const occupied = new Map<string, string>();

  for (const tile of next) {
    if (!pinnedIds.has(tile.id) || tile.row == null || tile.col == null) continue;
    occupied.set(`${tile.row},${tile.col}`, tile.id);
  }

  for (const tile of next) {
    let row = tile.row ?? 1;
    let col = tile.col ?? 1;
    row = clampGridPos(row, rows);
    col = clampGridPos(col, cols);

    const key = `${row},${col}`;
    const existing = occupied.get(key);
    if (existing && existing !== tile.id) {
      let placed = false;
      for (let r = 1; r <= rows && !placed; r++) {
        for (let c = 1; c <= cols && !placed; c++) {
          const slot = `${r},${c}`;
          if (!occupied.has(slot)) {
            row = r;
            col = c;
            placed = true;
          }
        }
      }
    }

    tile.row = row;
    tile.col = col;
    occupied.set(`${row},${col}`, tile.id);
  }

  return next;
}

/**
 * Apply board-voice item patches, reorder tiles, sync row/col for moves that
 * only specify order, and resolve grid collisions.
 */
export function prepareBoardVoiceComponents(
  components: PanelComponent[],
  items: BoardVoiceItem[],
  layoutRows: number,
  layoutCols: number,
): { components: PanelComponent[]; preservePositions: boolean } {
  const rows = Math.max(1, layoutRows);
  const cols = Math.max(1, layoutCols);
  const next = components.map((c) => ({ ...c }));
  const orderOverrides = new Map<string, number>();
  const explicitPositionIds = new Set<string>();

  for (const item of items) {
    if (!item.componentId) continue;
    const idx = next.findIndex((c) => c.id === item.componentId);
    if (idx < 0) continue;
    const tile = next[idx];
    if (item.purposeLabel) tile.purposeLabel = item.purposeLabel;
    if (item.rating) tile.rating = item.rating;
    if (item.row != null) {
      tile.row = clampGridPos(item.row, rows);
      explicitPositionIds.add(tile.id);
    }
    if (item.col != null) {
      tile.col = clampGridPos(item.col, cols);
      explicitPositionIds.add(tile.id);
    }
    if (item.order != null) orderOverrides.set(tile.id, item.order);
  }

  const hasExplicitPositions = explicitPositionIds.size > 0;

  if (orderOverrides.size > 0) {
    const slots: (PanelComponent | undefined)[] = new Array(next.length);
    const floating: PanelComponent[] = [];

    for (const tile of [...next].sort((a, b) => a.order - b.order)) {
      const target = orderOverrides.get(tile.id);
      if (target != null) {
        const idx = clampGridPos(target, next.length) - 1;
        slots[idx] = tile;
      } else {
        floating.push(tile);
      }
    }

    let fi = 0;
    for (let i = 0; i < next.length; i++) {
      if (!slots[i]) slots[i] = floating[fi++];
    }

    for (let i = 0; i < next.length; i++) {
      next[i] = slots[i]!;
    }
  } else if (hasExplicitPositions) {
    next.sort((a, b) => {
      if ((a.row ?? 0) !== (b.row ?? 0)) return (a.row ?? 0) - (b.row ?? 0);
      return (a.col ?? 0) - (b.col ?? 0);
    });
  }

  next.forEach((tile, i) => {
    tile.order = i + 1;
  });

  if (hasExplicitPositions) {
    const gridded = syncComponentGrid(next, rows, cols);
    for (let i = 0; i < next.length; i++) {
      if (!explicitPositionIds.has(next[i].id)) {
        next[i].row = gridded[i].row;
        next[i].col = gridded[i].col;
      }
    }
    const resolved = resolveGridCollisions(next, rows, cols, explicitPositionIds);
    return { components: resolved, preservePositions: true };
  }

  return { components: next, preservePositions: false };
}
