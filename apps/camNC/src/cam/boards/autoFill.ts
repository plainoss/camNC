import { fitsMachine } from '@wbcnc/cam/settle';
import { autoNest, type NestObjective, type SheetPacker } from '../autoNest';
import type { MaterialKey } from '../planSettings';
import {
  boardLabel,
  defaultMaterial,
  holdSettingsOf,
  nestBoard,
  newBoard,
  type BoardV1,
  type PartInstance,
  type StockBoardV1,
} from '../boards';
import { letter, onlyFor, thicknessKey } from './keys';
import { placedRect } from './placement';

/**
 * A stock board as much of it fits on the machine: whole when it fits (either way round), else cut down to the work
 * area, lying the way that keeps the most of it.
 */
export function withinMachine<S extends { w: number; h: number }>(sheet: S, machine: { w: number; h: number }): S {
  if (fitsMachine(machine, sheet.w, sheet.h)) return sheet;
  const along = { w: Math.min(sheet.w, machine.w), h: Math.min(sheet.h, machine.h) };
  const across = { w: Math.min(sheet.w, machine.h), h: Math.min(sheet.h, machine.w) };
  const { w, h } = along.w * along.h >= across.w * across.h ? along : across;
  return { ...sheet, w: Math.floor(w), h: Math.floor(h) };
}

/**
 * Put every body on boards from the stock list, per thickness, using as little stock as possible (see `autoNest`).
 * Bodies the user moved by hand (`pinned`) stay on their board (at their spot, if placed there), and free bodies fill the room left on such a board
 * first when it has a fixed size. Thicknesses without stock keep their boards. No board comes out bigger than the
 * stock (nor the machine, when given): bodies left when the stock runs out (`short`) go on more boards of the stock's
 * sizes, and bodies that fit on no stock board (`tooBig`) on one board of the biggest size, where they don't fit.
 */
export function autoFillFromStock(
  boards: BoardV1[],
  instances: PartInstance[],
  stock: StockBoardV1[],
  bit: number,
  material: MaterialKey,
  objective: NestObjective = 'boards',
  /** The machine's work area: stock boards bigger than it are used cut down to it. */
  machine?: { w: number; h: number },
  /** Names no board here may take: those of the boards that stay out of this (cut ones). */
  reserved: string[] = []
): { boards: BoardV1[]; tooBig: string[]; short: string[] } {
  if (machine) stock = stock.map(s => withinMachine(s, machine));
  const out: BoardV1[] = [];
  const tooBig: string[] = [];
  const short: string[] = [];
  const byId = new Map(instances.map(i => [i.id, i]));
  const thicknesses = [...new Set(instances.map(i => thicknessKey(i.thickness)))].sort((a, b) => b - a);
  for (const t of thicknesses) {
    const sheets = stock.filter(s => thicknessKey(s.thickness) === t);
    const old = boards.filter(b => b.thickness === t);
    const mine = instances.filter(i => thicknessKey(i.thickness) === t).map(i => i.id);
    if (!sheets.length) {
      out.push(...(old.length ? old : [newBoard(out, t, material, mine)]));
      continue;
    }
    const template = { ...newBoard([], t, old[0]?.material ?? defaultMaterial(t, material)) };
    if (old[0]) Object.assign(template, holdSettingsOf(old[0]));
    const fresh = (items: string[], size: BoardV1['size']): BoardV1 => ({ ...template, id: crypto.randomUUID(), items, size });

    const kept = old.flatMap(b => {
      const pinned = (b.pinned ?? []).filter(id => b.items.includes(id) && mine.includes(id));
      if (!pinned.length) return [];
      const held: BoardV1 = { ...b, items: pinned, pinned, ...(b.layout && { layout: { ...b.layout, at: onlyFor(b.layout.at, pinned) } }) };
      delete held.setAside;
      return [held];
    });
    let free = mine.filter(id => !kept.some(b => b.items.includes(id)));
    const left = new Map(sheets.map(s => [s.id, s.quantity ?? Infinity]));
    for (const b of kept) {
      if (b.size.fit) continue;
      const { w, h } = b.size;
      const sheet = sheets.find(s => s.w === w && s.h === h && left.get(s.id)! > 0);
      if (sheet) left.set(sheet.id, left.get(sheet.id)! - 1);
      if (!free.length) continue;
      const placed = new Set(nestBoard({ ...b, items: [...b.items, ...free] }, instances, bit, { holds: false }).placements.map(p => p.id));
      const items = [...b.items, ...free.filter(id => placed.has(id))];
      if (!b.items.every(id => placed.has(id)) || nestBoard({ ...b, items }, instances, bit, { holds: false }).unplaced.length) continue;
      b.items = items;
      free = free.filter(id => !placed.has(id));
    }

    const pack: SheetPacker = (ids, sheet) => {
      const nest = nestBoard(fresh(ids, { fit: false, w: sheet.w, h: sheet.h }), instances, bit, { holds: false });
      return {
        placed: nest.placements.map(p => p.id),
        used: nest.placements.map(p => {
          const r = placedRect(p, byId.get(p.id)!);
          return { ...r, w: r.w + nest.gap, h: r.h + nest.gap };
        }),
      };
    };
    const res = autoNest(
      free.map(id => ({ id, w: byId.get(id)!.size[0], h: byId.get(id)!.size[1] })),
      sheets.map(s => ({ id: s.id, w: s.w, h: s.h, quantity: Number.isFinite(left.get(s.id)) ? left.get(s.id) : undefined })),
      pack,
      { objective }
    );
    const rebuiltFrom = out.length + kept.length;
    out.push(...kept, ...res.boards.map(b => fresh(b.items, { fit: false, w: b.sheet.w, h: b.sheet.h })));
    // Never a board bigger than the stock: parts left when the stock ran out go on more boards of the stock's sizes
    // (to buy), and parts too big for any of them on one board of the biggest size, where they show as not fitting.
    if (res.short.length) {
      const more = autoNest(
        res.short.map(id => ({ id, w: byId.get(id)!.size[0], h: byId.get(id)!.size[1] })),
        sheets.map(s => ({ id: s.id, w: s.w, h: s.h })),
        pack,
        { objective }
      );
      out.push(...more.boards.map(b => fresh(b.items, { fit: false, w: b.sheet.w, h: b.sheet.h })));
    }
    if (res.tooBig.length) {
      const biggest = sheets.reduce((a, s) => (s.w * s.h > a.w * a.h ? s : a));
      out.push(fresh(res.tooBig, { fit: false, w: biggest.w, h: biggest.h }));
    }
    // The boards made here take over the names the user gave the ones they replace.
    const names = old.filter(b => boardLabel(b) === b.name && !kept.some(k => k.id === b.id)).map(b => b.name);
    out.slice(rebuiltFrom).forEach((b, i) => {
      if (names[i]) b.name = names[i];
    });
    tooBig.push(...res.tooBig);
    short.push(...res.short);
  }
  // A fresh layout: name the boards A, B, C… in order (kept boards of other thicknesses too, so names stay unique).
  // Boards with parts placed by hand keep their name, and so do boards the user named, and none takes a name that's `reserved`.
  const keepsName = (b: BoardV1) => !!b.pinned?.length || boardLabel(b) === b.name;
  const taken = new Set([...reserved, ...out.filter(keepsName).map(b => b.name)]);
  let k = 0;
  const named = out.map(b => {
    if (keepsName(b)) return b;
    while (taken.has(letter(k))) k++;
    return { ...b, name: letter(k++) };
  });
  return { boards: named, tooBig, short };
}
