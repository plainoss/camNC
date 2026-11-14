import { applyExtrudeRemovals } from './extrudeRemoval';
import { relieveStepOpenings } from './stepReliefFit';
import { effectivePartCutRelief, partCutReliefIssue } from './partCutRelief';
import { cadDocumentVersion } from './documentVersion';
import { newCadId } from './document';
import { validPartCutSplit } from './partCutSplit';
import { joinedCutReferences } from './joinedCutReferences';
import { physicalJoinedCopies } from './physicalJoinedCopies';
import { activeDesign } from './suppression';
import { resolvePartCutTargets } from './partCutTargetSelection';
import { cadPartReferenceOwner } from './partReferences';
import { evaluatedPartCopy, mirrorEvaluatedPart, sameCadCuts } from './copies';
import { cadDrawnOnSupports, effectivePlacement } from './drawnOn';
import { cadCopyName } from './partPatterns';
import { evaluateCadPartFamily } from './features';
import { evaluateCadPart, polygonArea } from './geometry';
import { rotateVector, type Vec3 } from './placement';
import { occupiedToolBoxes } from './occupiedToolBoxes';
import { certifiedToolProfile } from './certifiedToolProfile';
import { unionOf } from './unionParts';
import type { CadDiagnostic, CadDocument, CadPart, CadPartCut, CadPlacement, CadPoint, EvaluatedCadCut, EvaluatedCadPart } from './types';

const conjugate = ([x, y, z, w]: readonly number[]) => [-x!, -y!, -z!, w!];
const toWorld = (placement: CadPlacement, point: Vec3): Vec3 => {
  const turned = rotateVector(placement.rotation, point);
  return [turned[0] + placement.position[0], turned[1] + placement.position[1], turned[2] + placement.position[2]];
};
const toLocal = (placement: CadPlacement, point: Vec3): Vec3 =>
  rotateVector(conjugate(placement.rotation), [
    point[0] - placement.position[0],
    point[1] - placement.position[1],
    point[2] - placement.position[2],
  ]);
const kSquare = 1e-6;
/** Why a tool can't be cut in boxes: it's round or slanted, which its own outline can still cut. */
const kNotSquare = "isn't square-cornered and straight-sided";

/** A counterclockwise loop moved out by `by` mm on every side, its corners mitred; a negative `by` moves it in. */
function grown(loop: CadPoint[], by: number): CadPoint[] {
  if (!by) return loop;
  const normal = (a: CadPoint, b: CadPoint) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
  };
  return loop.map((point, i) => {
    const before = normal(loop[(i + loop.length - 1) % loop.length]!, point),
      after = normal(point, loop[(i + 1) % loop.length]!);
    // Where the two edges moved out meet; a sharp spike is capped at four times the distance.
    const scale = Math.min(4, 1 / Math.max(0.25, (1 + before.x * after.x + before.y * after.y) / 2));
    return { x: point.x + ((before.x + after.x) / 2) * by * scale, y: point.y + ((before.y + after.y) / 2) * by * scale };
  });
}

/** The part's box in its own frame: its outline's extent, and its thickness. */
function box(part: EvaluatedCadPart): [Vec3, Vec3] {
  const xs = part.outline.map(p => p.x),
    ys = part.outline.map(p => p.y);
  return [
    [Math.min(...xs), Math.min(...ys), 0],
    [Math.max(...xs), Math.max(...ys), part.thickness],
  ];
}

/** Whether one placement's axes each lie along one of the other's, as panels in a carcass do. */
function square(a: CadPlacement, b: CadPlacement): boolean {
  return (
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as Vec3[]
  ).every(axis => {
    const turned = rotateVector(conjugate(a.rotation), rotateVector(b.rotation, axis));
    return turned.filter(c => Math.abs(Math.abs(c) - 1) < kSquare).length === 1;
  });
}

/** How much of a polygon lies inside a rectangle. */
function areaWithin(polygon: CadPoint[], lo: Vec3, hi: Vec3): number {
  const edges: [(p: CadPoint) => number, (a: CadPoint, b: CadPoint) => CadPoint][] = [
    [p => p.x - lo[0], (a, b) => ({ x: lo[0], y: a.y + ((b.y - a.y) * (lo[0] - a.x)) / (b.x - a.x) })],
    [p => hi[0] - p.x, (a, b) => ({ x: hi[0], y: a.y + ((b.y - a.y) * (hi[0] - a.x)) / (b.x - a.x) })],
    [p => p.y - lo[1], (a, b) => ({ x: a.x + ((b.x - a.x) * (lo[1] - a.y)) / (b.y - a.y), y: lo[1] })],
    [p => hi[1] - p.y, (a, b) => ({ x: a.x + ((b.x - a.x) * (hi[1] - a.y)) / (b.y - a.y), y: hi[1] })],
  ];
  let points = polygon;
  for (const [inside, meet] of edges) {
    const kept: CadPoint[] = [];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length]!;
      if (inside(p) >= 0) kept.push(p);
      if (inside(p) >= 0 !== inside(q) >= 0) kept.push(meet(p, q));
    });
    points = kept;
  }
  return points.length < 3 ? 0 : Math.abs(polygonArea(points));
}

/** A continuous layer or side strip that connects the fingers of a face-sketched board. */
function splitBackbone(part: EvaluatedCadPart, boxes: [Vec3, Vec3][], axis: 0 | 1, clearance: number): boolean {
  const lo = [0, 1, 2].map(a => Math.min(...boxes.map(bounds => bounds[0][a]!))) as Vec3;
  const hi = [0, 1, 2].map(a => Math.max(...boxes.map(bounds => bounds[1][a]!))) as Vec3;
  if (lo[2] > clearance + kSquare || hi[2] + clearance < part.thickness - kSquare) return true;
  const across = axis === 0 ? 1 : 0;
  const [bottom, top] = box(part);
  return [
    [bottom[across], lo[across] - clearance],
    [hi[across] + clearance, top[across]],
  ].some(([from, to]) => {
    if (to! - from! <= kSquare) return false;
    const low: Vec3 = [...lo],
      high: Vec3 = [...hi];
    low[across] = from!;
    high[across] = to!;
    const area = (high[0] - low[0]) * (high[1] - low[1]);
    const material = areaWithin(part.outline, low, high) - part.holes.reduce((sum, hole) => sum + areaWithin(hole, low, high), 0);
    return material >= area - Math.max(area * 1e-6, kSquare);
  });
}

/** A box in one part's frame, seen in another's: both square to each other, so it's still a box. */
function carry(from: CadPlacement, to: CadPlacement, [lo, hi]: [Vec3, Vec3]): [Vec3, Vec3] {
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i =>
    toLocal(to, toWorld(from, [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]))
  );
  return [
    [0, 1, 2].map(a => Math.min(...corners.map(c => c[a]!))) as Vec3,
    [0, 1, 2].map(a => Math.max(...corners.map(c => c[a]!))) as Vec3,
  ];
}

/**
 * What a tool fills where it reaches into a target, as boxes in the target's frame: its outline within the target, in
 * rectangles, as deep as it reaches. A shouldered tenon fills only its tenon there, and a comb one box per finger. A
 * tool whose outline there isn't made of square corners and straight sides, or that has a cut of its own there, is
 * refused.
 */
function toolBoxes(
  tool: EvaluatedCadPart,
  toolAt: CadPlacement,
  into: EvaluatedCadPart,
  intoAt: CadPlacement,
  occupied = false,
  source?: CadPart
): { boxes: [Vec3, Vec3][] } | { refused: string } {
  if (occupied && source) tool = certifiedToolProfile(tool, source);
  const [tlo, thi] = box(tool);
  const [rlo, rhi] = carry(intoAt, toolAt, box(into));
  const lo = [0, 1, 2].map(a => Math.max(tlo[a]!, rlo[a]!)) as Vec3,
    hi = [0, 1, 2].map(a => Math.min(thi[a]!, rhi[a]!)) as Vec3;
  if (lo.some((value, a) => hi[a]! - value < kSquare)) return { boxes: [] };
  if (occupied) {
    const found = occupiedToolBoxes(tool, lo, hi);
    return 'refused' in found ? found : { boxes: found.boxes.map(bounds => carry(toolAt, intoAt, bounds)) };
  }
  // Split the reach into cells along every corner of the tool's outline and holes inside it, and keep the filled ones.
  const stops = (values: number[], from: number, to: number) =>
    [...new Set([from, to, ...values.filter(v => v > from + kSquare && v < to - kSquare)].map(v => Math.round(v * 1e6) / 1e6))].sort(
      (a, b) => a - b
    );
  const loops = [tool.outline, ...tool.holes];
  const xs = stops(
      loops.flatMap(loop => loop.map(p => p.x)),
      lo[0],
      hi[0]
    ),
    ys = stops(
      loops.flatMap(loop => loop.map(p => p.y)),
      lo[1],
      hi[1]
    );
  // A curved tool would split into slivers that aren't what it fills.
  const curved = kNotSquare;
  if ((xs.length - 1) * (ys.length - 1) > 400) return { refused: curved };
  const slack = Math.max((hi[0] - lo[0]) * (hi[1] - lo[1]) * 1e-6, kSquare);
  // Each cell is all tool or none of it; one only partly filled means a slanted or curved side, which no box fits.
  const filled: boolean[][] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    filled.push([]);
    for (let i = 0; i + 1 < xs.length; i++) {
      const cellLo: Vec3 = [xs[i]!, ys[j]!, 0],
        cellHi: Vec3 = [xs[i + 1]!, ys[j + 1]!, 0];
      const covered =
        areaWithin(tool.outline, cellLo, cellHi) - tool.holes.reduce((sum, hole) => sum + areaWithin(hole, cellLo, cellHi), 0);
      const cell = (cellHi[0] - cellLo[0]) * (cellHi[1] - cellLo[1]);
      if (covered > slack && covered < cell - slack) return { refused: curved };
      filled[j]!.push(covered >= cell - slack);
    }
  }
  // Runs of filled cells along each row, then runs the same width stacked up into rectangles.
  const rectangles: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    const y0 = ys[j]!,
      y1 = ys[j + 1]!;
    for (let i = 0; i + 1 < xs.length; i++) {
      if (!filled[j]![i]) continue;
      let k = i + 1;
      while (k + 1 < xs.length && filled[j]![k]) k++;
      const x0 = xs[i]!,
        x1 = xs[k]!;
      const below = rectangles.find(r => r.y1 === y0 && r.x0 === x0 && r.x1 === x1);
      if (below) below.y1 = y1;
      else rectangles.push({ x0, x1, y0, y1 });
      i = k - 1;
    }
  }
  const ownCut = (tool.cuts ?? []).some(cut => {
    const [bottom, top] = cut.side === 'top' ? [tool.thickness - cut.to, tool.thickness - cut.from] : [cut.from, cut.to];
    return top > lo[2] + kSquare && bottom < hi[2] - kSquare && areaWithin(cut.outline, lo, hi) > slack;
  });
  if (ownCut) return { refused: 'has a cut of its own' };
  return {
    boxes: rectangles.map(r =>
      carry(toolAt, intoAt, [
        [r.x0, r.y0, lo[2]],
        [r.x1, r.y1, hi[2]],
      ])
    ),
  };
}

/**
 * A tool standing on a target's face, its sketch's plane parallel to the target's, cuts its own outline in, whatever its
 * shape: a round dowel makes a round hole. Its outline and holes are carried into the target's frame, and its reach is
 * how far it goes in from that face. None when it isn't parallel or doesn't reach in.
 */
function toolOutlineCut(
  tool: EvaluatedCadPart,
  toolAt: CadPlacement,
  into: EvaluatedCadPart,
  intoAt: CadPlacement
): { outline: CadPoint[]; islands: CadPoint[][]; lo: number; hi: number } | null {
  const normal = rotateVector(conjugate(intoAt.rotation), rotateVector(toolAt.rotation, [0, 0, 1]));
  if (Math.abs(Math.abs(normal[2]) - 1) > kSquare) return null;
  const carried = (loop: CadPoint[], z: number) => loop.map(p => toLocal(intoAt, toWorld(toolAt, [p.x, p.y, z])));
  const bottom = carried(tool.outline, 0),
    top = carried(tool.outline, tool.thickness);
  const lo = Math.max(0, Math.min(bottom[0]![2], top[0]![2])),
    hi = Math.min(into.thickness, Math.max(bottom[0]![2], top[0]![2]));
  if (hi - lo < kSquare) return null;
  const flat = (points: Vec3[]) => {
    const loop = points.map(([x, y]) => ({ x, y }));
    return polygonArea(loop) < 0 ? loop.reverse() : loop;
  };
  const outline = flat(bottom);
  const [ilo, ihi] = box(into);
  if (areaWithin(outline, ilo, ihi) < kSquare) return null;
  return { outline, islands: tool.holes.map(hole => flat(carried(hole, 0)).reverse()), lo, hi };
}

/**
 * The cuts each "cut parts" step makes, added to the parts it cuts. Wherever a tool part reaches into a target part, as
 * placed, that much of the target is cut away, widened by the step's clearance on every side inside the target, and as
 * deep as the tool reaches in plus the clearance, from whichever face it enters. It follows the parts as they move and change size. The
 * target's corner relief gives it bones. A tool that doesn't reach a target leaves it alone, and one with a hole, notch or
 * cut where it reaches in is left out with a warning rather than cut as a block.
 */
export function applyPartCuts(
  given: CadDocument,
  parts: readonly EvaluatedCadPart[],
  options: { occupiedTools?: boolean } = {}
): { parts: EvaluatedCadPart[]; diagnostics: CadDiagnostic[] } {
  const document = physicalJoinedCopies(activeDesign(given));
  const diagnostics: CadDiagnostic[] = [];
  const byId = new Map(parts.map(part => [part.partId, part]));
  const sources = new Map(document.parts.map(part => [part.id, part]));
  // Tools reach with their profile outline, before bones or step cuts, so two parts can cut each other.
  const before = new Map(
    parts.map(part => {
      const source = sources.get(part.partId);
      const outline = !options.occupiedTools && source?.cornerRelief && document.partCuts?.length && evaluateCadPart(source).part?.outline;
      return [part.partId, outline ? { ...part, outline } : part];
    })
  );
  const supports = cadDrawnOnSupports(document);
  const targets = new Map(
    parts.map(part => [
      part.partId,
      [
        { key: '', at: sources.get(part.partId) && effectivePlacement(sources.get(part.partId)!, supports), shape: part, mirrored: false },
        ...(sources.get(part.partId)?.copies ?? []).map(copy => ({
          key: copy.id,
          at: copy.placement,
          // A preceding removal can give each instance different cuts; don't copy the original's cuts over them.
          shape: evaluatedPartCopy(part, copy),
          mirrored: !!copy.mirrored,
        })),
      ],
    ])
  );
  // Targets given an opening, by name. Their bones are worked out once, after every step has cut: relief depends only
  // on the square openings, never on step order, and doing it per opening made a part with dozens of mortises slow.
  // Later steps read tools and targets from `before`, so nothing in between sees the bones.
  const relieved = new Map<{ shape: EvaluatedCadPart }, string>();
  /** Puts `shape`, its new opening still square, on the target. */
  const settleRelief = (target: { shape: EvaluatedCadPart }, partName: string, shape: EvaluatedCadPart) => {
    target.shape = shape;
    relieved.set(target, partName);
  };
  for (const step of document.partCuts ?? []) {
    let made = 0,
      refused = false;
    // Each copy of a target is cut on its own, so the same problem is said once per step, not once per copy.
    const said = new Set<string>();
    const warn = (message: string, code = 'part-cut-unresolved') => {
      if (!said.has(message)) diagnostics.push({ code, severity: 'warning', message });
      said.add(message);
    };
    if (step.operation === 'union' || step.operation === 'intersect') {
      // The tools join the first target, in its place; kept, they stay parts of their own too.
      const joined = unionOf(document, step);
      const host = targets.get(step.targets[0]!)?.[0];
      if ('refused' in joined || !host)
        warn('refused' in joined ? joined.refused : 'A Boolean › Union’s part is gone.', 'boolean-unresolved');
      else {
        host.shape = joined.part;
        before.set(step.targets[0]!, joined.part);
      }
      continue;
    }
    const cutBoxes = (
      target: { shape: EvaluatedCadPart },
      intoSource: (typeof document.parts)[number],
      name: string,
      boxes: [Vec3, Vec3][],
      prefix: string
    ) => {
      const into = target.shape;
      const t = into.thickness,
        [ilo, ihi] = box(into),
        c = step.clearance;
      const reaches = boxes.map(([lo, hi]) => ({
        lo: [0, 1, 2].map(a => Math.max(lo[a]!, ilo[a]!)) as Vec3,
        hi: [0, 1, 2].map(a => Math.min(hi[a]!, ihi[a]!)) as Vec3,
      }));
      // Two rectangles of one tool that meet aren't widened into each other.
      const meets = (index: number, axis: 0 | 1, at: number) =>
        reaches.some(
          (other, j) =>
            j !== index &&
            (Math.abs(other.lo[axis] - at) < kSquare || Math.abs(other.hi[axis] - at) < kSquare) &&
            other.lo[1 - axis]! < reaches[index]!.hi[1 - axis]! - kSquare &&
            other.hi[1 - axis]! > reaches[index]!.lo[1 - axis]! + kSquare &&
            // Occupied tools have several height layers. Only a neighbour covering this complete face can make
            // it internal; a lower neighbour must not suppress clearance on an exposed upper pocket wall.
            (!options.occupiedTools ||
              (other.lo[2] <= reaches[index]!.lo[2] &&
                other.hi[2] >= reaches[index]!.hi[2] &&
                other.lo[1 - axis]! <= reaches[index]!.lo[1 - axis]! &&
                other.hi[1 - axis]! >= reaches[index]!.hi[1 - axis]!))
        );
      reaches.forEach(({ lo, hi }, index) => {
        const fromTop = hi[2] >= t - kSquare,
          fromBelow = lo[2] <= kSquare;
        if (!fromTop && !fromBelow) {
          warn(`${name} sits inside ${intoSource.name} without reaching either face, so it can't be cut.`);
          return;
        }
        // The clearance widens each side inside the part. A side that runs off its edge stays there, open.
        const widen = (axis: 0 | 1, side: 'lo' | 'hi') => {
          const at = side === 'lo' ? lo[axis] : hi[axis];
          const inside = side === 'lo' ? at > ilo[axis] + kSquare : at < ihi[axis] - kSquare;
          return inside && !meets(index, axis, at) ? (side === 'lo' ? at - c : at + c) : at;
        };
        const x0 = widen(0, 'lo'),
          x1 = widen(0, 'hi'),
          y0 = widen(1, 'lo'),
          y1 = widen(1, 'hi');
        const outline = [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ];
        // The clearance deepens it too, so the tool doesn't bottom out. Reaching within it of the far face cuts through.
        const reach = Math.min(t, (fromTop && fromBelow ? t : fromTop ? t - lo[2] : hi[2]) + c),
          through = reach >= t - kSquare;
        const setting = effectivePartCutRelief(step, intoSource);
        const current = target.shape;
        // The first piece keeps the ID a tool's one cut always had.
        const id = `${prefix}${index ? `#${index}` : ''}`;
        const cut: EvaluatedCadCut = {
          id,
          regionId: id,
          side: fromTop ? 'top' : 'underside',
          from: 0,
          to: through ? t : reach,
          through,
          // Square here; its bones are added with every other opening's, below.
          outline,
          islands: [],
          opening: { x0, y0, x1, y1 },
          tool: { x0: lo[0], y0: lo[1], x1: hi[0], y1: hi[1] },
          ...(setting && { relief: setting.diameter }),
        };
        settleRelief(target, intoSource.name, { ...current, cuts: [...(current.cuts ?? []), cut] });
        made++;
      });
    };
    if (!validPartCutSplit(step.split)) {
      warn('Invalid split in a "cut parts" step: fingers must be an integer of at least 2.');
      continue;
    }
    const targetReferences = joinedCutReferences(document, step.targets);
    const selection = resolvePartCutTargets(
      document,
      targetReferences.map(item => item.reference)
    );
    for (const reference of selection.missing) {
      refused = true;
      const owner = cadPartReferenceOwner(document, reference);
      warn(
        owner
          ? `The target copy of ${owner.name} is not present. Restore its pattern count or choose another target.`
          : 'A target part of this cut no longer exists. Choose another target.',
        'part-cut-target-missing'
      );
    }
    // Exact-copy split joints need their own reciprocal-cut semantics; accepting them would promise an unsupported mode.
    // The authored scope decides support: a derived child family must not hide an explicit copy restriction.
    if (step.split && resolvePartCutTargets(document, step.targets).targets.some(target => target.copyId !== undefined)) {
      warn(
        'Split joints on a single target copy are not supported. Choose Cut out or target the source family.',
        'part-cut-copy-target-split'
      );
      continue;
    }
    // A tool `<partId>:<copyId>` cuts with that one copy; a copy that's gone is said once, not once per target.
    const goneCopies = new Set<string>();
    for (const { part: intoSource, copyId: targetCopyId } of selection.targets)
      for (const { reference: toolId, origin: toolOrigin } of joinedCutReferences(document, step.tools)) {
        const targetId = intoSource.id;
        const [partId, copyId] = toolId.split(/:(.*)/s) as [string, string?];
        // Source-family self cuts were already refused. An exact target must not bypass that owner guard.
        if (partId === targetId) continue;
        const toolSource = sources.get(partId);
        const tool = before.get(partId);
        if (!toolSource || !tool) continue;
        if (copyId !== undefined && !toolSource.copies?.some(copy => copy.id === copyId)) {
          refused = true;
          if (!goneCopies.has(toolId)) warn(`The copy of ${toolSource.name} this step cuts with no longer exists.`);
          goneCopies.add(toolId);
          continue;
        }
        for (const target of targets.get(targetId) ?? []) {
          if (targetCopyId !== undefined && target.key !== targetCopyId) continue;
          // Derived host components retain the raw selection's owner. Otherwise a host selected on both
          // sides would start cutting itself, or an explicit child-copy selection could enable every sibling.
          if (
            !targetReferences.some(
              ({ reference, origin }) => origin !== toolOrigin && (reference === targetId || reference === `${targetId}:${target.key}`)
            )
          )
            continue;
          const original = before.get(targetId)!;
          const into = target.mirrored ? mirrorEvaluatedPart(original) : original,
            intoAt = target.at;
          const toolAt = effectivePlacement(toolSource, supports);
          // A part that hasn't been placed isn't anywhere yet, so it reaches into nothing.
          if (!intoAt) continue;
          // Each copy of a tool cuts where it sits, a mirrored one with its mirror image.
          const instances = [
            ...(copyId === undefined && toolAt ? [{ key: '', at: toolAt, shape: tool, name: toolSource.name }] : []),
            ...(toolSource.copies ?? []).flatMap((copy, index) =>
              (copyId === undefined || copy.id === copyId) && copy.placement
                ? [
                    {
                      key: `:${copy.id}`,
                      at: copy.placement,
                      shape: evaluatedPartCopy(tool, copy),
                      name: cadCopyName(toolSource, index),
                    },
                  ]
                : []
            ),
          ];
          for (const { key, at, shape, name } of instances) {
            if (!square(intoAt, at)) {
              refused = true;
              warn(`${name} isn't square to ${intoSource.name}, so it can't be cut from it yet.`);
              continue;
            }
            const found = toolBoxes(shape, at, into, intoAt, options.occupiedTools, toolSource);
            // A round or slanted tool entering a face cuts its own outline in.
            // Only a shape boxes can't follow: a tool with a cut of its own there stays refused.
            const outlined =
              'refused' in found && found.refused === kNotSquare && !step.split ? toolOutlineCut(shape, at, into, intoAt) : null;
            if (outlined) {
              const t = into.thickness,
                fromTop = outlined.hi >= t - kSquare,
                fromBelow = outlined.lo <= kSquare;
              if (!fromTop && !fromBelow) {
                refused = true;
                warn(`${name} sits inside ${intoSource.name} without reaching either face, so it can't be cut.`);
                continue;
              }
              // The clearance deepens it, so the tool doesn't bottom out. Reaching within it of the far face cuts through.
              const reach = Math.min(t, (fromTop && fromBelow ? t : fromTop ? t - outlined.lo : outlined.hi) + step.clearance),
                through = reach >= t - kSquare;
              const id = `cut-parts:${step.id}:${partId}${key}`;
              const cut: EvaluatedCadCut = {
                id,
                regionId: id,
                side: fromTop ? 'top' : 'underside',
                from: 0,
                to: through ? t : reach,
                through,
                // The clearance widens it all round, and narrows what the tool's holes leave standing.
                outline: grown(outlined.outline, step.clearance),
                islands: outlined.islands.map(island => grown([...island].reverse(), -step.clearance).reverse()),
              };
              // Bones cut earlier beside it may have to give way to it.
              settleRelief(target, intoSource.name, { ...target.shape, cuts: [...(target.shape.cuts ?? []), cut] });
              made++;
              continue;
            }
            if ('refused' in found) {
              refused = true;
              warn(`${name} ${found.refused} where it reaches into ${intoSource.name}, so it can't be cut from it yet.`);
              continue;
            }
            if (!step.split) {
              cutBoxes(target, intoSource, name, found.boxes, `cut-parts:${step.id}:${partId}${key}`);
              continue;
            }
            const normal = rotateVector(conjugate(intoAt.rotation), rotateVector(at.rotation, [0, 0, 1]));
            const parallel = Math.abs(normal[2]) > 1 - kSquare;
            const reverse = toolBoxes(into, intoAt, shape, at, options.occupiedTools, intoSource);
            if ('refused' in reverse) {
              refused = true;
              warn(`${intoSource.name} ${reverse.refused} where it reaches into ${name}, so it can't be cut from it yet.`);
              continue;
            }
            const opposite = reverse.boxes.map(bounds => carry(at, intoAt, bounds));
            // Both outlines limit the overlap: a stepped board may stop short of its bounding box here.
            const overlap = found.boxes.flatMap(([lo, hi]) =>
              opposite.flatMap(([rlo, rhi]) => {
                const bottom = [0, 1, 2].map(a => Math.max(lo[a]!, rlo[a]!)) as Vec3,
                  top = [0, 1, 2].map(a => Math.min(hi[a]!, rhi[a]!)) as Vec3;
                return bottom.every((value, a) => top[a]! - value > kSquare) ? [[bottom, top] as [Vec3, Vec3]] : [];
              })
            );
            if (!overlap.length) continue;
            const span = (axis: 0 | 1) =>
              Math.max(...overlap.map(bounds => bounds[1][axis])) - Math.min(...overlap.map(bounds => bounds[0][axis]));
            // A strip sketched on a board's face can extrude across its thickness into a perpendicular board.
            // Its extrusion axis is still parallel to the first board's: the longer shared span runs along the joint.
            const axis = parallel ? (span(0) >= span(1) ? 0 : 1) : ([0, 1] as const).find(a => Math.abs(normal[a]) < kSquare)!;
            const unit: Vec3 = [0, 0, 0];
            unit[axis] = 1;
            const localAxis = (placement: CadPlacement) => {
              const direction = rotateVector(conjugate(placement.rotation), rotateVector(intoAt.rotation, unit));
              return ([0, 1] as const).find(a => Math.abs(direction[a]) > 1 - kSquare)!;
            };
            // Each board needs its own connection. A thicker tool's depth backbone cannot keep a thinner
            // target from being severed into strips; clearance must also leave the connection intact.
            if (
              parallel &&
              (!splitBackbone(into, overlap, axis, step.clearance) ||
                !splitBackbone(
                  shape,
                  overlap.map(bounds => carry(intoAt, at, bounds)),
                  localAxis(at),
                  step.clearance
                ))
            ) {
              refused = true;
              warn(
                `${name} and ${intoSource.name} each need material beyond or alongside the overlap to connect the fingers of a split joint.`
              );
              continue;
            }
            const world = rotateVector(intoAt.rotation, unit);
            // Orient the shared line towards its positive world end, independent of either sketch's direction.
            const sign = world.find(value => Math.abs(value) > kSquare)! < 0 ? -1 : 1;
            const lo = Math.min(...overlap.map(bounds => bounds[0][axis])),
              hi = Math.max(...overlap.map(bounds => bounds[1][axis]));
            const count = step.split === 'half' ? 2 : step.split.fingers;
            const segments = (boxes: [Vec3, Vec3][], placement: CadPlacement, parity: number): [Vec3, Vec3][] => {
              const a = localAxis(placement);
              return Array.from({ length: count }, (_, i) => i).flatMap(i => {
                if (i % 2 !== parity) return [];
                const from = sign > 0 ? hi - ((i + 1) * (hi - lo)) / count : lo + (i * (hi - lo)) / count,
                  to = sign > 0 ? hi - (i * (hi - lo)) / count : lo + ((i + 1) * (hi - lo)) / count;
                const point: Vec3 = [0, 0, 0];
                point[axis] = from;
                const first = toLocal(placement, toWorld(intoAt, point))[a];
                point[axis] = to;
                const last = toLocal(placement, toWorld(intoAt, point))[a];
                return boxes.flatMap(([bottom, top]) => {
                  const low: Vec3 = [...bottom],
                    high: Vec3 = [...top];
                  low[a] = Math.max(low[a], Math.min(first, last));
                  high[a] = Math.min(high[a], Math.max(first, last));
                  // Perpendicular extrusions need through slots. A face-sketched board instead keeps the depth
                  // outside the overlap as its backbone; extending these cuts through would sever its fingers.
                  if (!parallel) {
                    low[2] = 0;
                    high[2] = placement === intoAt ? into.thickness : shape.thickness;
                  }
                  return high[a] - low[a] > kSquare ? [[low, high] as [Vec3, Vec3]] : [];
                });
              });
            };
            const receiver = targets.get(partId)!.find(instance => instance.key === key.slice(1))!;
            cutBoxes(target, intoSource, name, segments(overlap, intoAt, 0), `cut-parts:${step.id}:${partId}${key}`);
            cutBoxes(
              receiver,
              toolSource,
              intoSource.name,
              segments(
                overlap.map(bounds => carry(intoAt, at, bounds)),
                at,
                1
              ),
              `cut-parts:${step.id}:${targetId}:lap${target.key ? `:${target.key}` : ''}`
            );
          }
        }
      }
    // A tool that was refused reaches in; it says why itself.
    if (!made && !refused && step.tools.length && step.targets.length)
      warn('A "cut parts" step cuts nothing: none of its tools reach into its targets.');
  }
  // Copies of one target are cut alike, so their corners are said once, at the first one's.
  const reliefSaid = new Set<string>();
  for (const [target, partName] of relieved) {
    const { part, skipped } = relieveStepOpenings(target.shape);
    target.shape = part;
    for (const [id, points] of skipped) {
      const toolId = /^cut-parts:[^:]+:([^:#]+)/.exec(id)?.[1];
      const tool = document.parts.find(candidate => candidate.id === toolId)?.name ?? 'another part';
      const message = `${points.length} of the corners ${tool} cuts in ${partName} stay square: a bone there would cut into another edge or opening.`;
      if (!reliefSaid.has(message)) diagnostics.push({ code: 'corner-relief-skipped', severity: 'warning', message, points });
      reliefSaid.add(message);
    }
  }
  for (const [id, instances] of targets) {
    const original = instances[0]!.shape;
    const copyCuts: Record<string, EvaluatedCadCut[]> = {};
    for (const copy of instances.slice(1)) {
      const cuts = (copy.mirrored ? mirrorEvaluatedPart(copy.shape) : copy.shape).cuts ?? [];
      if (!sameCadCuts(original.cuts, cuts)) copyCuts[copy.key] = cuts;
    }
    const { copyCuts: _previousCopyCuts, ...shape } = original;
    byId.set(id, { ...shape, ...(Object.keys(copyCuts).length && { copyCuts }) });
  }
  return { parts: parts.map(part => byId.get(part.partId)!), diagnostics };
}

/**
 * One evaluated part with the cuts other parts make in it, for views that evaluate a part on its own. The tools are
 * evaluated as they are in `document`.
 */
export function withPartCuts(given: CadDocument, part: EvaluatedCadPart): EvaluatedCadPart {
  const document = physicalJoinedCopies(activeDesign(given));
  const steps = (document.partCuts ?? []).filter(
    step =>
      joinedCutReferences(document, step.targets).some(({ reference }) => cadPartReferenceOwner(document, reference)?.id === part.partId) ||
      (step.split &&
        joinedCutReferences(document, step.tools).some(({ reference }) => cadPartReferenceOwner(document, reference)?.id === part.partId))
  );
  if (!steps.length && !document.parts.some(candidate => candidate.remove)) return part;
  const toolIds = [
    ...new Set(
      steps.flatMap(step =>
        joinedCutReferences(document, [...step.targets, ...step.tools]).map(
          ({ reference }) => cadPartReferenceOwner(document, reference)?.id
        )
      )
    ),
  ].filter(id => id !== part.partId);
  const tools = toolIds.flatMap(id => {
    const source = document.parts.find(candidate => candidate.id === id);
    const profile = source && evaluateCadPart(source).part;
    return source && profile ? [evaluateCadPartFamily(source, profile).part] : [];
  });
  return applyPartCuts(document, applyExtrudeRemovals(document, [part, ...tools]).parts).parts[0]!;
}

/** Adds a step that cuts the tool parts out of the target parts, with this much room around them. */
export function addPartCut(
  document: CadDocument,
  tools: string[],
  targets: string[],
  clearance: { value: number; expression?: string },
  split?: CadPartCut['split'],
  cornerRelief?: CadPartCut['cornerRelief']
): { document: CadDocument; id: string } {
  if (!validPartCutSplit(split)) throw new Error('Invalid CAD part cut');
  const reliefIssue = partCutReliefIssue(cornerRelief);
  if (reliefIssue) throw new Error(reliefIssue);
  const step: CadPartCut = {
    id: newCadId(),
    tools,
    targets,
    clearance: clearance.value,
    ...(split !== undefined && { split }),
    ...(clearance.expression && { clearanceExpression: clearance.expression }),
    ...(cornerRelief !== undefined && { cornerRelief }),
  };
  const next = {
    ...document,
    revision: document.revision + 1,
    partCuts: [...(document.partCuts ?? []), step],
    ...(document.operationOrder && { operationOrder: [...document.operationOrder, step.id] }),
  };
  return { id: step.id, document: { ...next, version: cadDocumentVersion(next) } };
}

/** Changes a step's parts or clearance. A clearance given without an expression drops the step's old one. */
export function updatePartCut(document: CadDocument, id: string, change: Partial<Omit<CadPartCut, 'id'>>): CadDocument {
  if (!validPartCutSplit(change.split)) throw new Error('Invalid CAD part cut');
  const reliefIssue = partCutReliefIssue(change.cornerRelief);
  if (reliefIssue) throw new Error(reliefIssue);
  const documentWithChange = {
    ...document,
    revision: document.revision + 1,
    partCuts: (document.partCuts ?? []).map(step => {
      if (step.id !== id) return step;
      const next = { ...step, ...change };
      if (change.clearance !== undefined && !change.clearanceExpression) delete next.clearanceExpression;
      if (Object.hasOwn(change, 'split') && change.split === undefined) delete next.split;
      // Kept is the default, so it's only stored when the tools are used up.
      if (Object.hasOwn(change, 'consumeTools') && !change.consumeTools) delete next.consumeTools;
      if (Object.hasOwn(change, 'cornerRelief') && change.cornerRelief === undefined) delete next.cornerRelief;
      return next;
    }),
  };
  return { ...documentWithChange, version: cadDocumentVersion(documentWithChange) };
}

export function removePartCut(document: CadDocument, id: string): CadDocument {
  const next: CadDocument = {
    ...document,
    revision: document.revision + 1,
    partCuts: (document.partCuts ?? []).filter(step => step.id !== id),
    ...(document.operationOrder && { operationOrder: document.operationOrder.filter(operation => operation !== id) }),
    ...(document.legacyPartCutIds && { legacyPartCutIds: document.legacyPartCutIds.filter(operation => operation !== id) }),
  };
  if (!next.partCuts!.length) delete next.partCuts;
  return { ...next, version: cadDocumentVersion(next) };
}
