import type { FingerprintMesh, PartFingerprint } from './meshFingerprint';
import { surfaceDistance, type DistanceStats } from './surfaceDistance';

/** A part's fingerprint, with its mesh when it was read from a STEP file rather than a saved fingerprint. */
export interface FingerprintedPart {
  fingerprint: PartFingerprint;
  mesh?: FingerprintMesh;
}

export interface CompareTolerances {
  /** Allowed volume difference, percent of the expected volume. */
  volumePercent: number;
  /** Allowed difference of each bbox coordinate, mm. */
  bbox: number;
  /** Allowed largest distance between the surfaces, either way, mm. */
  distance: number;
  /** Points sampled on each surface. */
  samples: number;
}

/** 0.05 mm is five times the 0.01 mm chord error of the meshes, well below what a real modelling difference moves. */
export const defaultTolerances: CompareTolerances = { volumePercent: 0.1, bbox: 0.01, distance: 0.05, samples: 20_000 };

export interface ComparedPart {
  expected: string;
  actual: string;
  volumeDiffPercent: number;
  bboxMaxAbsDiff: number;
  /** Null when one side is a saved fingerprint, which has no surface to measure. */
  distance: { expectedToActual: DistanceStats; actualToExpected: DistanceStats } | null;
  genus: { expected: number; actual: number };
  pass: { volume: boolean; bbox: boolean; distance: boolean | null; genus: boolean };
}

export interface Comparison {
  equal: boolean;
  parts: ComparedPart[];
  unmatched: { side: 'expected' | 'actual'; name: string; volume: number }[];
  failures: string[];
}

const round = (value: number, digits = 6) => +value.toFixed(digits);

/**
 * Pairs the parts by volume, nearest first, and checks each pair's volume, bbox, genus and surfaces. Both sides are
 * taken in the same frame (see `stepFingerprint`): nothing is aligned, so a part that moved fails.
 */
export function compareParts(
  expected: readonly FingerprintedPart[],
  actual: readonly FingerprintedPart[],
  tolerances: CompareTolerances = defaultTolerances
): Comparison {
  const failures: string[] = [];
  if (expected.length !== actual.length) failures.push(`Expected ${expected.length} parts, got ${actual.length}.`);
  const pairs = expected
    .flatMap((e, i) => actual.map((a, j) => ({ i, j, gap: Math.abs(e.fingerprint.volume - a.fingerprint.volume) })))
    .sort((x, y) => x.gap - y.gap);
  const usedExpected = new Set<number>(),
    usedActual = new Set<number>(),
    matched: [number, number][] = [];
  for (const { i, j } of pairs) {
    if (usedExpected.has(i) || usedActual.has(j)) continue;
    usedExpected.add(i);
    usedActual.add(j);
    matched.push([i, j]);
  }
  matched.sort((x, y) => x[0] - y[0]);
  const parts = matched.map(([i, j]) => {
    const e = expected[i]!,
      a = actual[j]!;
    const part = comparePair(e, a, tolerances);
    const label =
      e.fingerprint.name === a.fingerprint.name ? `“${e.fingerprint.name}”` : `“${e.fingerprint.name}” / “${a.fingerprint.name}”`;
    if (!part.pass.volume)
      failures.push(`${label}: volume differs by ${part.volumeDiffPercent.toFixed(4)} % (allowed ${tolerances.volumePercent} %).`);
    if (!part.pass.bbox)
      failures.push(`${label}: bounding box differs by ${part.bboxMaxAbsDiff.toFixed(4)} mm (allowed ${tolerances.bbox} mm).`);
    if (!part.pass.genus) failures.push(`${label}: genus ${part.genus.expected} expected, got ${part.genus.actual}.`);
    if (part.pass.distance === false) {
      const d = part.distance!;
      failures.push(
        `${label}: surfaces are up to ${Math.max(d.expectedToActual.max, d.actualToExpected.max).toFixed(4)} mm apart (allowed ${tolerances.distance} mm).`
      );
    }
    return part;
  });
  const unmatched = [
    ...expected
      .filter((_, i) => !usedExpected.has(i))
      .map(p => ({ side: 'expected' as const, name: p.fingerprint.name, volume: round(p.fingerprint.volume) })),
    ...actual
      .filter((_, j) => !usedActual.has(j))
      .map(p => ({ side: 'actual' as const, name: p.fingerprint.name, volume: round(p.fingerprint.volume) })),
  ];
  for (const part of unmatched) failures.push(`“${part.name}” (${part.side}) has no counterpart.`);
  return { equal: failures.length === 0, parts, unmatched, failures };
}

function comparePair(e: FingerprintedPart, a: FingerprintedPart, tolerances: CompareTolerances): ComparedPart {
  const ef = e.fingerprint,
    af = a.fingerprint;
  const volumeDiffPercent = ef.volume ? ((af.volume - ef.volume) / Math.abs(ef.volume)) * 100 : af.volume ? Infinity : 0;
  let bboxMaxAbsDiff = 0;
  for (const corner of ['min', 'max'] as const)
    for (let axis = 0; axis < 3; axis++)
      bboxMaxAbsDiff = Math.max(bboxMaxAbsDiff, Math.abs(ef.bbox[corner][axis]! - af.bbox[corner][axis]!));
  const distance =
    e.mesh && a.mesh
      ? {
          // Different seeds each way, so neither direction reuses the other's sample pattern.
          expectedToActual: rounded(surfaceDistance(e.mesh, a.mesh, tolerances.samples, 1)),
          actualToExpected: rounded(surfaceDistance(a.mesh, e.mesh, tolerances.samples, 2)),
        }
      : null;
  return {
    expected: ef.name,
    actual: af.name,
    volumeDiffPercent: round(volumeDiffPercent),
    bboxMaxAbsDiff: round(bboxMaxAbsDiff),
    distance,
    genus: { expected: ef.genus, actual: af.genus },
    pass: {
      volume: Math.abs(volumeDiffPercent) <= tolerances.volumePercent,
      bbox: bboxMaxAbsDiff <= tolerances.bbox,
      distance: distance && Math.max(distance.expectedToActual.max, distance.actualToExpected.max) <= tolerances.distance,
      genus: ef.genus === af.genus,
    },
  };
}

const rounded = ({ max, mean }: DistanceStats): DistanceStats => ({ max: round(max), mean: round(mean) });
