import {
  CAD_CHORD_TOLERANCE,
  cadVariableValues,
  rotateVector,
  smallestCornerRelief,
  type CadConstruction,
  type CadConstructionHardware,
  type CadDocument,
  type EvaluatedCadPart,
} from '@wbcnc/cad';
import {
  furnitureBoxClear,
  furnitureDepthBreaks,
  furnitureMembers,
  furnitureVoidRadius,
  furnitureVoidWall,
  type FurnitureMember,
  type FurniturePoint,
} from './furnitureGeometry';

export interface FurnitureHardwareCheck {
  hardwareId: string;
  check: string;
  passed: boolean;
  actual?: number;
  expected?: number;
}
interface Anchor {
  member: FurnitureMember;
  purpose: 'clearance' | 'pilot';
  start: FurniturePoint;
  axis: FurniturePoint;
  radius: number;
  depth: number;
  wall?: number;
}
const dot = (a: FurniturePoint, b: FurniturePoint) => a.reduce((sum, n, i) => sum + n * b[i]!, 0);
const minus = (a: FurniturePoint, b: FurniturePoint) => a.map((n, i) => n - b[i]!) as FurniturePoint;

function measuredAnchor(member: FurnitureMember, anchor: CadConstructionHardware['holes'][number]): Anchor | undefined {
  if (anchor.entityIds.length !== 1) return;
  const profile = member.source.sketch.id === anchor.sketchId;
  const feature = member.source.features?.find(
    f => f.type === 'sketch' && f.sketch.id === anchor.sketchId && (f.copyId === undefined || f.copyId === member.copy?.id)
  );
  const sketch = profile ? member.source.sketch : feature?.type === 'sketch' ? feature.sketch : undefined;
  if (!sketch || (feature?.type === 'sketch' && typeof feature.on === 'object')) return;
  const circle = sketch.entities.find(e => e.id === anchor.entityIds[0]);
  if (circle?.type !== 'circle' || circle.construction) return;
  const center = sketch.entities.find(e => e.id === circle.centerId);
  if (center?.type !== 'point') return;
  const fromTop = !profile && feature?.type === 'sketch' && feature.on === 'top';
  const x = center.x * (!profile && feature?.type === 'sketch' && feature.on === 'underside' ? -1 : 1) * (member.copy?.mirrored ? -1 : 1);
  const point = { x, y: center.y },
    t = member.shape.thickness;
  const breaks = furnitureDepthBreaks(member.shape);
  if (fromTop) breaks.reverse();
  let depth = 0,
    radius = Infinity,
    wall: number | undefined = Infinity;
  for (let i = 1; i < breaks.length; i++) {
    const r = furnitureVoidRadius(member.shape, point, (breaks[i - 1]! + breaks[i]!) / 2);
    if (r <= 0) break;
    depth += Math.abs(breaks[i]! - breaks[i - 1]!);
    radius = Math.min(radius, r);
    const sectionWall = furnitureVoidWall(member.shape, point, (breaks[i - 1]! + breaks[i]!) / 2);
    wall = wall === undefined || sectionWall === undefined ? undefined : Math.min(wall, sectionWall);
  }
  if (!Number.isFinite(radius)) radius = 0;
  return {
    member,
    purpose: anchor.purpose,
    radius,
    depth,
    wall,
    start: member.world([x, center.y, fromTop ? t : 0]),
    axis: rotateVector(member.at.rotation, [0, 0, fromTop ? -1 : 1]),
  };
}

/** Conservative hardware/access envelopes. A refusal can require a more detailed arrangement; it never invents clearance. */
function clearEnvelope(anchor: Anchor, lo: number, hi: number, radius: number, members: Iterable<FurnitureMember>) {
  const a = anchor.start.map((n, i) => n + anchor.axis[i]! * lo) as FurniturePoint;
  const b = anchor.start.map((n, i) => n + anchor.axis[i]! * hi) as FurniturePoint;
  const low = a.map((n, i) => Math.min(n, b[i]!) - radius * Math.sqrt(Math.max(0, 1 - anchor.axis[i]! ** 2))) as FurniturePoint;
  const high = a.map((n, i) => Math.max(n, b[i]!) + radius * Math.sqrt(Math.max(0, 1 - anchor.axis[i]! ** 2))) as FurniturePoint;
  return furnitureBoxClear(members, low, high, new Set([anchor.member.identity]));
}

/** Actual evaluated holes/stock and physical instances, not names or a copied declaration of fit. */
export function checkFurnitureHardware(
  document: CadDocument,
  parts: readonly EvaluatedCadPart[],
  plan: CadConstruction,
  selectedCutter: number
): FurnitureHardwareCheck[] {
  const members = furnitureMembers(document, parts, plan),
    variables = cadVariableValues(document);
  const checks: FurnitureHardwareCheck[] = [];
  // Relieved joint corners only clear when the cutter is no wider than the relief they were drawn for.
  const reliefs = [...members.values()]
    .map(member => smallestCornerRelief(document, member.source.id))
    .filter((diameter): diameter is number => diameter !== undefined);
  if (reliefs.length)
    checks.push({
      hardwareId: plan.id,
      check: 'The selected cutter reaches the relieved joint corners.',
      passed: Number.isFinite(selectedCutter) && selectedCutter <= Math.min(...reliefs) + 1e-6,
      actual: selectedCutter,
      expected: Math.min(...reliefs),
    });
  // Each keyed tenon is held by exactly one bolt through its own key, and no physical hole serves two items.
  for (const connection of plan.connections.filter(c => c.kind === 'keyed-through-tenon')) {
    const bolts = plan.hardware.filter(h => connection.hardwareIds.includes(h.id) && h.kind === 'key-locking-bolt');
    checks.push({
      hardwareId: connection.id,
      check: 'The keyed tenon is retained by one key-locking bolt through its own key.',
      passed: bolts.length === 1 && bolts[0]!.holes.some(hole => hole.purpose === 'clearance' && connection.roles.includes(hole.role)),
    });
  }
  const holeKeys = plan.hardware.flatMap(h =>
    h.holes.map(hole => `${members.get(hole.role)?.identity ?? hole.role}|${hole.sketchId}|${[...hole.entityIds].sort().join()}`)
  );
  checks.push({
    hardwareId: plan.id,
    check: 'No physical hole is declared for two hardware items.',
    passed: new Set(holeKeys).size === holeKeys.length,
  });
  for (const hardware of plan.hardware) {
    const record = (check: string, passed: boolean, actual?: number, expected?: number) =>
      checks.push({ hardwareId: hardware.id, check, passed, actual, expected });
    const anchors = hardware.holes.map(h => {
      const member = members.get(h.role);
      return member && measuredAnchor(member, h);
    });
    record('All purchased-hardware holes resolve to active evaluated material.', anchors.every(Boolean));
    if (anchors.some(a => !a)) continue;
    const holes = anchors as Anchor[];
    // Each bounded hardware specification has one anchor per physical member.
    // Different role names or alternate entity decompositions cannot manufacture
    // a second receiving member out of the same source/copy.
    const identities = holes.map(a => a.member.identity);
    record('Distinct mating holes do not alias the same physical feature.', new Set(identities).size === identities.length);
    const clearance = holes.filter(a => a.purpose === 'clearance'),
      pilots = holes.filter(a => a.purpose === 'pilot');
    const entry = clearance[0];
    record('The hardware has exactly one supported drive-side clearance hole.', clearance.length === 1);
    if (!entry) continue;
    record(
      'The clearance opening passes through the actual wooden member.',
      Math.abs(entry.depth - entry.member.shape.thickness) <= 0.001,
      entry.depth,
      entry.member.shape.thickness
    );
    record(
      'The actual clearance opening accepts the shank with design clearance.',
      entry.radius >= hardware.diameter / 2 + 0.1,
      2 * entry.radius,
      hardware.diameter + 0.2
    );
    record(
      'The clearance opening leaves the head and washer a bearing face.',
      2 * entry.radius <= Math.min(hardware.headDiameter, hardware.washerDiameter) - 1,
      2 * entry.radius,
      Math.min(hardware.headDiameter, hardware.washerDiameter) - 1
    );
    record(
      'The selected cutter fits the actual smallest opening.',
      Number.isFinite(selectedCutter) && selectedCutter > 0 && holes.every(a => a.radius >= selectedCutter / 2 + CAD_CHORD_TOLERANCE),
      Math.min(...holes.map(a => 2 * a.radius)),
      selectedCutter
    );
    record(
      'The actual key/button retains material around its hardware opening.',
      entry.wall !== undefined && Number.isFinite(entry.wall) && entry.wall >= 4,
      entry.wall,
      4
    );
    const variable = document.variables?.find(v => v.id === hardware.lengthVariableId);
    const length = variable && variables.scope[variable.name]?.value;
    record(
      'Installed hardware length resolves to a finite positive dimension.',
      typeof length === 'number' && Number.isFinite(length) && length > 0
    );
    if (typeof length !== 'number' || !Number.isFinite(length)) continue;
    if (hardware.kind === 'key-locking-bolt') {
      record(
        'The key uses the specified M4 self-retained bolt, washers and prevailing-torque locknut.',
        holes.length === 1 &&
          pilots.length === 0 &&
          hardware.diameter === 4 &&
          hardware.installation === 'head-washers-prevailing-torque-nut' &&
          hardware.nutHeight >= 5 &&
          hardware.nutHeight <= 6 &&
          hardware.washerThickness >= 1 &&
          hardware.washerThickness <= 2 &&
          hardware.washerDiameter >= 12 &&
          hardware.headDiameter >= 7
      );
      record('The specified tools retain the pattern installation allowance.', hardware.accessRadius >= 8 && hardware.accessLength >= 40);
      record('The bolt is an available length in this bounded hardware specification.', [25, 30, 35, 40, 45].includes(length));
      const projection = length - entry.member.shape.thickness - 2 * hardware.washerThickness - hardware.nutHeight;
      record(
        'Threads pass through the locknut without excessive exposed projection.',
        projection >= hardware.minimumThreadProjection && projection <= 10,
        projection,
        hardware.minimumThreadProjection
      );
      record(
        'The bolt head and washers/nut have unobstructed installed envelopes.',
        clearEnvelope(
          entry,
          -hardware.washerThickness - hardware.headHeight,
          0,
          Math.max(hardware.washerDiameter, hardware.headDiameter) / 2,
          members.values()
        ) &&
          clearEnvelope(
            entry,
            entry.member.shape.thickness,
            length - hardware.washerThickness,
            hardware.washerDiameter / 2,
            members.values()
          )
      );
      record(
        'Both ends have the specified driver/socket installation access.',
        clearEnvelope(
          entry,
          -hardware.washerThickness - hardware.headHeight - hardware.accessLength,
          -hardware.washerThickness - hardware.headHeight,
          hardware.accessRadius,
          members.values()
        ) &&
          clearEnvelope(
            entry,
            entry.member.shape.thickness + hardware.washerThickness + hardware.nutHeight,
            entry.member.shape.thickness + hardware.washerThickness + hardware.nutHeight + hardware.accessLength,
            hardware.accessRadius,
            members.values()
          )
      );
    } else {
      record(
        'The seat uses the specified 5 mm pan-head wood screw with washer.',
        hardware.diameter === 5 &&
          hardware.headDiameter >= 9.9 &&
          hardware.washerDiameter >= 12 &&
          hardware.washerThickness >= 1 &&
          hardware.accessRadius >= 8 &&
          hardware.accessLength >= 40
      );
      record(
        'Seat fastening has a distinct receiving pilot and accessible installation from below.',
        pilots.length === 1 &&
          hardware.installation === 'pilot-and-drive-from-below' &&
          pilots[0]?.member.identity !== entry.member.identity
      );
      const pilot = pilots[0];
      if (!pilot) continue;
      // Wood screws bite in a pilot of about their core diameter: too small splits, too large holds nothing.
      record(
        'The receiving pilot is sized for the screw core.',
        2 * pilot.radius >= 0.6 * hardware.diameter && 2 * pilot.radius <= 0.85 * hardware.diameter,
        2 * pilot.radius,
        0.7 * hardware.diameter
      );
      const delta = minus(pilot.start, entry.start),
        along = dot(delta, entry.axis);
      const perpendicular = Math.hypot(...delta.map((n, i) => n - entry.axis[i]! * along));
      record(
        'Actual clearance and receiving pilot axes are coaxial and face the installation direction.',
        perpendicular <= 0.05 && dot(entry.axis, pilot.axis) >= 0.999999 && along >= entry.member.shape.thickness - 0.01,
        perpendicular,
        0.05
      );
      const engagement = length - hardware.washerThickness - along;
      record(
        'The specified seat screw engages the receiving member and fits its pilot depth.',
        engagement >= 10 && pilot.depth >= engagement + 0.5,
        engagement,
        10
      );
      const floor = pilot.member.shape.thickness - pilot.depth;
      record('Actual material remains above the blind seat pilot.', floor >= 3, floor, 3);
      record(
        'The driver/washer have the stated access below the attachment.',
        clearEnvelope(
          entry,
          -hardware.headHeight - hardware.washerThickness - hardware.accessLength,
          0,
          Math.max(hardware.accessRadius, hardware.washerDiameter / 2),
          members.values()
        )
      );
    }
  }
  return checks;
}
