import { cadVariableValues, type CadConstruction, type CadDocument, type EvaluatedCadPart } from '@wbcnc/cad';
import { clipLoopToBox, furnitureMaterial, furnitureMembers, type FurnitureMember, type FurniturePoint } from './furnitureGeometry';
import { checkFurnitureHardware } from './furnitureHardware';

export interface FurnitureJointCheck {
  connectionId: string;
  check: string;
  passed: boolean;
  actual?: number;
  expected?: number;
}
interface Box {
  low: FurniturePoint;
  high: FurniturePoint;
}
interface Tenon {
  connectionId: string;
  receivers: FurnitureMember[];
  world: Box;
}

/** Pattern minimums for the bounded frame recipe; geometry only, never a load rating. */
const kMinimumEngagement = 20;
const kMinimumShoulder = 8;
const kMinimumWall = 6;
const kMinimumWeb = 5;
const kTolerance = 0.01;

const boxOf = (points: readonly FurniturePoint[]): Box => ({
  low: [0, 1, 2].map(i => Math.min(...points.map(p => p[i]!))) as FurniturePoint,
  high: [0, 1, 2].map(i => Math.max(...points.map(p => p[i]!))) as FurniturePoint,
});
const corners = (box: Box) =>
  Array.from(
    { length: 8 },
    (_, i) => [i & 1 ? box.high[0] : box.low[0], i & 2 ? box.high[1] : box.low[1], i & 4 ? box.high[2] : box.low[2]] as FurniturePoint
  );
const boxGap = (a: Box, b: Box) => Math.hypot(...[0, 1, 2].map(i => Math.max(0, a.low[i]! - b.high[i]!, b.low[i]! - a.high[i]!)));

/** World boxes of a member's actual evaluated cut cells, dogbones included. */
function cutBoxes(member: FurnitureMember): Box[] {
  const t = member.shape.thickness;
  return (member.shape.cuts ?? []).map(cut => {
    const flat = boxOf(cut.outline.map(p => [p.x, p.y, 0]));
    const z = cut.side === 'top' ? [t - cut.to, t - cut.from] : [cut.from, cut.to];
    return boxOf(corners({ low: [flat.low[0], flat.low[1], z[0]!], high: [flat.high[0], flat.high[1], z[1]!] }).map(member.world));
  });
}

/**
 * Measures each glued shouldered tenon from evaluated material: the tenon is the tenoned member's actual profile inside
 * its receivers, its mortise is actually empty, and relieved mortises in one receiver keep a web between them.
 */
export function checkFurnitureJoints(
  document: CadDocument,
  parts: readonly EvaluatedCadPart[],
  plan: CadConstruction
): FurnitureJointCheck[] {
  const members = furnitureMembers(document, parts, plan);
  const checks: FurnitureJointCheck[] = [];
  const tenons: Tenon[] = [];
  const fitVariable = plan.parameters.find(p => p.name === 'fit');
  const fitName = document.variables?.find(v => v.id === fitVariable?.variableId)?.name;
  const fitValue = fitName && cadVariableValues(document).scope[fitName]?.value;
  const fit = typeof fitValue === 'number' && Number.isFinite(fitValue) ? fitValue : 0;
  for (const connection of plan.connections) {
    const record = (check: string, passed: boolean, actual?: number, expected?: number) =>
      checks.push({ connectionId: connection.id, check, passed, actual, expected });
    const resolved = connection.roles.map(role => members.get(role));
    record('Every member of the connection resolves to active evaluated material.', resolved.every(Boolean));
    if (resolved.some(m => !m)) continue;
    const bound = resolved as FurnitureMember[];
    if (connection.kind === 'glued-lamination') {
      const [a, b] = bound as [FurnitureMember, FurnitureMember];
      const faces = [0, 1, 2].filter(i => Math.abs(a.high[i]! - b.low[i]!) <= kTolerance || Math.abs(b.high[i]! - a.low[i]!) <= kTolerance);
      const flush = [0, 1, 2].every(
        i => faces.includes(i) || (Math.abs(a.low[i]! - b.low[i]!) <= kTolerance && Math.abs(a.high[i]! - b.high[i]!) <= kTolerance)
      );
      record('Laminations meet face to face over their full outline.', bound.length === 2 && faces.length === 1 && flush);
    } else if (connection.kind === 'glued-shouldered-tenon') {
      const tenoned = bound[bound.length - 1]!,
        receivers = bound.slice(0, -1);
      const receiving = boxOf(receivers.flatMap(r => [r.low, r.high]));
      const entries = [0, 1, 2].filter(
        i => tenoned.low[i]! < receiving.low[i]! - kTolerance || tenoned.high[i]! > receiving.high[i]! + kTolerance
      );
      const overlap: Box = {
        low: [0, 1, 2].map(i => Math.max(tenoned.low[i]!, receiving.low[i]!)) as FurniturePoint,
        high: [0, 1, 2].map(i => Math.min(tenoned.high[i]!, receiving.high[i]!)) as FurniturePoint,
      };
      const local = boxOf(corners(overlap).map(tenoned.local));
      // Shrink the clip so the shoulder edge lying exactly on the receiver face isn't counted as tenon.
      const clipped = clipLoopToBox(
        tenoned.shape.outline,
        { x: local.low[0] + kTolerance, y: local.low[1] + kTolerance },
        { x: local.high[0] - kTolerance, y: local.high[1] - kTolerance }
      );
      const entry = entries[0];
      record('The tenoned member enters its receivers through exactly one face.', entries.length === 1 && clipped.length > 2);
      if (entry === undefined || entries.length !== 1 || clipped.length <= 2) continue;
      const z = [Math.max(0, local.low[2]), Math.min(tenoned.shape.thickness, local.high[2])];
      const tenonLocal = boxOf(clipped.map(p => [p.x, p.y, 0]));
      const world = boxOf(
        corners({ low: [tenonLocal.low[0], tenonLocal.low[1], z[0]!], high: [tenonLocal.high[0], tenonLocal.high[1], z[1]!] }).map(
          tenoned.world
        )
      );
      const engagement = world.high[entry]! - world.low[entry]!;
      // Half the receiving depth, up to the pattern minimum: a thin apron holds a cleat by half its thickness.
      const needed = Math.min(kMinimumEngagement, (receiving.high[entry]! - receiving.low[entry]!) / 2);
      record('The tenon engages its receivers by the pattern minimum.', engagement >= needed - 2 * kTolerance, engagement, needed);
      // The in-plane axis across the entry direction carries the shoulders.
      const along = Math.abs(tenoned.world([1, 0, 0])[entry]! - tenoned.world([0, 0, 0])[entry]!) > 0.5 ? 0 : 1;
      const across = 1 - along;
      const body = boxOf(tenoned.shape.outline.map(p => [p.x, p.y, 0]));
      const shoulders = [tenonLocal.low[across]! - body.low[across]!, body.high[across]! - tenonLocal.high[across]!];
      record(
        'Shoulders above and below the tenon bear on the receiver face.',
        Math.min(...shoulders) >= kMinimumShoulder - kTolerance,
        Math.min(...shoulders),
        kMinimumShoulder
      );
      const outward = tenoned.high[entry]! > receiving.high[entry]! + kTolerance;
      const walls = [0, 1, 2].flatMap(i =>
        i !== entry
          ? [world.low[i]! - receiving.low[i]!, receiving.high[i]! - world.high[i]!]
          : [outward ? world.low[i]! - receiving.low[i]! : receiving.high[i]! - world.high[i]!]
      );
      record(
        'The mortise is closed by receiver material on every side but its entry.',
        Math.min(...walls) >= kMinimumWall - kTolerance,
        Math.min(...walls),
        kMinimumWall
      );
      // Sample inside the tenon; a filled, suppressed or shallow mortise leaves receiver material there.
      const inset: Box = {
        low: world.low.map((n, i) => n + Math.min(1, (world.high[i]! - n) / 4)) as FurniturePoint,
        high: world.high.map((n, i) => n - Math.min(1, (n - world.low[i]!) / 4)) as FurniturePoint,
      };
      const samples = Array.from(
        { length: 27 },
        (_, k) =>
          [0, 1, 2].map(i => inset.low[i]! + ((Math.floor(k / 3 ** i) % 3) / 2) * (inset.high[i]! - inset.low[i]!)) as FurniturePoint
      );
      record(
        'The receivers are actually cut away where the tenon sits.',
        samples.every(p => receivers.every(r => !furnitureMaterial(r.shape, r.local(p))))
      );
      tenons.push({ connectionId: connection.id, receivers, world });
    } else if (connection.kind === 'seat-attachment') {
      const ids = new Set(connection.hardwareIds);
      record(
        'The seat is fastened through each cleat by at least two purchased screws.',
        connection.hardwareIds.length >= 2 && plan.hardware.filter(h => ids.has(h.id) && h.kind === 'seat-screw').length === ids.size
      );
    }
  }
  // Group mortises by receiving leg/apron; every pair that shares a receiver keeps a measured, relieved web.
  const groups = new Map<string, Tenon[]>();
  for (const tenon of tenons) {
    const key = tenon.receivers.map(r => r.identity).join('|');
    groups.set(key, [...(groups.get(key) ?? []), tenon]);
  }
  for (const group of groups.values()) {
    const cells = group[0]!.receivers.flatMap(cutBoxes);
    const owned = group.map(t => {
      const grown: Box = {
        low: t.world.low.map(n => n - fit - 4.5) as FurniturePoint,
        high: t.world.high.map(n => n + fit + 4.5) as FurniturePoint,
      };
      return cells.filter(c =>
        [0, 1, 2].every(i => (c.low[i]! + c.high[i]!) / 2 >= grown.low[i]! && (c.low[i]! + c.high[i]!) / 2 <= grown.high[i]!)
      );
    });
    group.forEach((t, i) =>
      checks.push({
        connectionId: t.connectionId,
        check: 'The mortise is machined in the receiving material.',
        passed: owned[i]!.length > 0,
      })
    );
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const web = Math.min(...owned[i]!.flatMap(a => owned[j]!.map(b => boxGap(a, b))));
        checks.push({
          connectionId: `${group[i]!.connectionId}+${group[j]!.connectionId}`,
          check: 'Relieved mortises sharing a receiver keep a web between them.',
          passed: Number.isFinite(web) && web >= kMinimumWeb - kTolerance,
          actual: web,
          expected: kMinimumWeb,
        });
      }
  }
  const attached = new Set(plan.connections.filter(c => c.kind === 'seat-attachment').flatMap(c => c.roles));
  if (plan.recipe === 'frame-stool-glued-v1')
    checks.push({ connectionId: 'seat', check: 'The seat has a positive fastened attachment.', passed: attached.has('seat') });
  return checks;
}

export interface FurnitureConstructionCheck {
  /** A connection or purchased hardware ID. */
  id: string;
  check: string;
  passed: boolean;
  actual?: number;
  expected?: number;
}

/** Joints and hardware together, with the plan's own cutter parameter. */
export function checkFurnitureConstruction(
  document: CadDocument,
  parts: readonly EvaluatedCadPart[],
  plan: CadConstruction
): FurnitureConstructionCheck[] {
  const cutterVariable = plan.parameters.find(p => p.name === 'cutter');
  const name = document.variables?.find(v => v.id === cutterVariable?.variableId)?.name;
  const value = name && cadVariableValues(document).scope[name]?.value;
  const cutter = typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  return [
    ...checkFurnitureJoints(document, parts, plan).map(({ connectionId, ...c }) => ({ id: connectionId, ...c })),
    ...checkFurnitureHardware(document, parts, plan, cutter).map(({ hardwareId, ...c }) => ({ id: hardwareId, ...c })),
  ];
}
