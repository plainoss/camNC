export interface TraceCoverage {
  intersectionOverUnion: number;
  removedFraction: number;
  addedFraction: number;
  boundaryErrorPx: number;
  maxBoundaryErrorPx: number;
  meanDeviationPx: number;
}

/** Exact four-connected pixel topology, including tiny light counters; no polygon simplification is involved. */
export function traceMaskTopology(ink: Uint8Array, width: number): { components: number; holes: number } {
  const visited = new Uint8Array(ink.length),
    queue = new Uint32Array(ink.length);
  let components = 0,
    holes = 0;
  for (let first = 0; first < ink.length; first++) {
    if (visited[first]) continue;
    const dark = ink[first];
    let end = 1,
      border = false;
    queue[0] = first;
    visited[first] = 1;
    for (let at = 0; at < end; at++) {
      const i = queue[at];
      if (i < width || i >= ink.length - width || i % width === 0 || i % width === width - 1) border = true;
      for (const next of [i % width ? i - 1 : -1, i % width < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (next >= 0 && next < ink.length && ink[next] === dark && !visited[next]) {
          visited[next] = 1;
          queue[end++] = next;
        }
      }
    }
    if (dark) components++;
    else if (!border) holes++;
  }
  return { components, holes };
}

/**
 * Flip four-connected regions of one value smaller than a physical area threshold. Dark specks are removed; light
 * regions are only filled when enclosed (pinholes), never the open background. Holes at or above the threshold, such as
 * eyes or letter counters, are kept.
 */
function flipSmallRegions(ink: Uint8Array, width: number, maxAreaPixels: number, dark: boolean): { components: number; pixels: number } {
  const value = dark ? 1 : 0;
  const visited = new Uint8Array(ink.length),
    queue = new Uint32Array(ink.length);
  let components = 0,
    pixels = 0;
  for (let first = 0; first < ink.length; first++) {
    if (ink[first] !== value || visited[first]) continue;
    let end = 1,
      border = false;
    queue[0] = first;
    visited[first] = 1;
    for (let at = 0; at < end; at++) {
      const i = queue[at];
      if (i < width || i >= ink.length - width || i % width === 0 || i % width === width - 1) border = true;
      for (const next of [i % width ? i - 1 : -1, i % width < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (next >= 0 && next < ink.length && ink[next] === value && !visited[next]) {
          visited[next] = 1;
          queue[end++] = next;
        }
      }
    }
    if (end >= maxAreaPixels || (!dark && border)) continue;
    components++;
    pixels += end;
    for (let at = 0; at < end; at++) ink[queue[at]] = 1 - value;
  }
  return { components, pixels };
}

/** Remove isolated dark specks below a physical area threshold. */
export function removeTraceSpecks(ink: Uint8Array, width: number, maxAreaPixels: number): { components: number; pixels: number } {
  return flipSmallRegions(ink, width, maxAreaPixels, true);
}

/** Fill enclosed light pinholes below a physical area threshold; no tool can leave such a small uncut island. */
export function fillTracePinholes(ink: Uint8Array, width: number, maxAreaPixels: number): { components: number; pixels: number } {
  return flipSmallRegions(ink, width, maxAreaPixels, false);
}

/**
 * Raster coverage and two-way nearest-boundary comparison on the complete bounded tracing grid. `boundaryErrorPx`
 * ignores the worst 0.01% of boundary pixels (at least one): an isolated pixel at a hair-thin tip that no fit can
 * follow. `maxBoundaryErrorPx` keeps them, and is `Infinity` beyond `maxRadius`. `meanDeviationPx` is the mismatched
 * area per source boundary pixel, an average edge displacement that, unlike overlap, does not penalize thin strokes.
 */
export function compareTraceMasks(source: Uint8Array, result: Uint8Array, width: number, maxRadius: number): TraceCoverage {
  const height = source.length / width;
  const boundary = (mask: Uint8Array) => {
    const marked = new Uint8Array(mask.length),
      points: number[] = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      if (
        !i ||
        i < width ||
        i >= mask.length - width ||
        i % width === 0 ||
        i % width === width - 1 ||
        !mask[i - 1] ||
        !mask[i + 1] ||
        !mask[i - width] ||
        !mask[i + width]
      ) {
        marked[i] = 1;
        points.push(i);
      }
    }
    return { marked, points };
  };
  let original = 0,
    shared = 0,
    removed = 0,
    added = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i]) {
      original++;
      if (result[i]) shared++;
      else removed++;
    } else if (result[i]) added++;
  }
  const a = boundary(source),
    b = boundary(result);
  const offsets: { x: number; y: number; distance: number }[] = [];
  for (let y = -maxRadius; y <= maxRadius; y++)
    for (let x = -maxRadius; x <= maxRadius; x++) offsets.push({ x, y, distance: Math.hypot(x, y) });
  offsets.sort((p, q) => p.distance - q.distance);
  const ignored = Math.max(1, Math.floor((a.points.length + b.points.length) * 1e-4));
  // The `ignored + 1` largest distances, ascending; the first is the error with the worst `ignored` pixels left out.
  const worst: number[] = [];
  for (const [from, to] of [
    [a, b],
    [b, a],
  ])
    for (const i of from.points) {
      const x = i % width,
        y = Math.floor(i / width);
      const nearest = offsets.find(
        offset =>
          x + offset.x >= 0 &&
          x + offset.x < width &&
          y + offset.y >= 0 &&
          y + offset.y < height &&
          to.marked[(y + offset.y) * width + x + offset.x]
      );
      const distance = nearest ? nearest.distance : Infinity;
      if (worst.length > ignored && distance <= worst[0]) continue;
      let at = 0;
      while (at < worst.length && worst[at] < distance) at++;
      worst.splice(at, 0, distance);
      if (worst.length > ignored + 1) worst.shift();
    }
  return {
    intersectionOverUnion: shared / Math.max(1, original + added),
    removedFraction: removed / Math.max(1, original),
    addedFraction: added / Math.max(1, original),
    boundaryErrorPx: worst.length > ignored ? worst[0] : 0,
    maxBoundaryErrorPx: worst.length ? worst[worst.length - 1] : 0,
    meanDeviationPx: (removed + added) / Math.max(1, a.points.length),
  };
}

/** One 3 × 3 dilation of `value` pixels. Outside the grid is light, so a light margin along the border is kept. */
function grow3(from: Uint8Array, width: number, value: number): Uint8Array {
  const height = from.length / width;
  const to = new Uint8Array(from.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++)
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          const nx = x + dx,
            ny = y + dy;
          hit = nx >= 0 && nx < width && ny >= 0 && ny < height ? from[ny * width + nx] === value : value === 0;
        }
      to[y * width + x] = hit === (value === 1) ? 1 : 0;
    }
  return to;
}

/** Apply a morphological result to `ink` unless it changes a significant region, and return the changed pixel count. */
function applyMorphology(ink: Uint8Array, result: Uint8Array, width: number, keepFeaturesAreaPx: number): number {
  // A wall between two shapes is a feature, unlike the tip of a gap: refuse a change that merges or removes regions.
  if (keepFeaturesAreaPx && traceFeatureChanges(ink, result, width, keepFeaturesAreaPx)) return 0;
  let changed = 0;
  for (let i = 0; i < ink.length; i++)
    if (result[i] !== ink[i]) {
      ink[i] = result[i];
      changed++;
    }
  return changed;
}

/**
 * Morphological closing with a 3 × 3 square: fills light gaps at most two pixels wide, including the tip of a light
 * wedge that narrows below a pixel. Curve fitting cannot follow such a gap, so the source would never match its trace.
 * With `keepFeaturesAreaPx`, nothing is closed when closing would merge or remove a region of at least that area.
 */
export function closeTraceGaps(ink: Uint8Array, width: number, keepFeaturesAreaPx = 0): number {
  const closed = grow3(grow3(ink, width, 1), width, 0);
  for (let i = 0; i < ink.length; i++) closed[i] ||= ink[i];
  return applyMorphology(ink, closed, width, keepFeaturesAreaPx);
}

/**
 * Morphological opening with a 3 × 3 square, the dark counterpart of `closeTraceGaps`: removes dark slivers about two
 * pixels wide (up to 2.8 on a diagonal), such as the hair-thin tip of a pointed feather or a neck where two strokes
 * barely touch. Curve fitting rounds such a tip off or cuts such a neck, so the source would never match its trace.
 * Each connected piece it would remove of at least `keepAreaPx` stays, so a whole thin stroke, whisker or dot of that
 * size is never dropped here; the trace checks then measure it like any other feature.
 */
export function openTraceSlivers(ink: Uint8Array, width: number, keepAreaPx: number): number {
  const height = ink.length / width;
  const opened = grow3(grow3(ink, width, 0), width, 1);
  const removed = new Uint8Array(ink.length);
  for (let i = 0; i < ink.length; i++) removed[i] = ink[i] && !opened[i] ? 1 : 0;
  const queue = new Uint32Array(ink.length);
  let changed = 0;
  for (let first = 0; first < ink.length; first++) {
    if (removed[first] !== 1) continue;
    // Eight-connected: a diagonal stroke's removed pixels touch only at corners.
    let end = 1;
    queue[0] = first;
    removed[first] = 2;
    for (let at = 0; at < end; at++) {
      const i = queue[at],
        x = i % width,
        y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          if (removed[next] === 1) {
            removed[next] = 2;
            queue[end++] = next;
          }
        }
    }
    if (end >= keepAreaPx) continue;
    for (let at = 0; at < end; at++) ink[queue[at]] = 0;
    changed += end;
  }
  return changed;
}

/** Four-connected labels of both dark and light regions, with each label's area and whether it touches the border. */
function labelRegions(mask: Uint8Array, width: number) {
  const labels = new Int32Array(mask.length).fill(-1),
    queue = new Uint32Array(mask.length),
    areas: number[] = [],
    border: boolean[] = [];
  for (let first = 0; first < mask.length; first++) {
    if (labels[first] >= 0) continue;
    const id = areas.length,
      value = mask[first];
    let end = 1,
      touches = false;
    queue[0] = first;
    labels[first] = id;
    for (let at = 0; at < end; at++) {
      const i = queue[at];
      if (i < width || i >= mask.length - width || i % width === 0 || i % width === width - 1) touches = true;
      for (const next of [i % width ? i - 1 : -1, i % width < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (next >= 0 && next < mask.length && mask[next] === value && labels[next] < 0) {
          labels[next] = id;
          queue[end++] = next;
        }
      }
    }
    areas.push(end);
    border.push(touches);
  }
  return { labels, areas, border };
}

/**
 * Match filled regions and holes between a source mask and its trace by position, not by count. Every source region
 * of at least `minAreaPx` (and the open background) must overlap a traced region of the same color, and every such
 * traced region a source one; a significant region overlapping two significant regions on the other side is a split
 * or merge. Regions below `minAreaPx` may appear or vanish: curve fitting cannot keep a sliver or pinhole a few pixels
 * across.
 */
export function traceFeatureChanges(source: Uint8Array, traced: Uint8Array, width: number, minAreaPx: number): number {
  const a = labelRegions(source, width),
    b = labelRegions(traced, width);
  const significant = (r: ReturnType<typeof labelRegions>, id: number) => r.border[id] || r.areas[id] >= minAreaPx;
  const partnersA = a.areas.map(() => new Set<number>()),
    partnersB = b.areas.map(() => new Set<number>());
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== traced[i]) continue;
    partnersA[a.labels[i]].add(b.labels[i]);
    partnersB[b.labels[i]].add(a.labels[i]);
  }
  let changes = 0;
  const check = (r: ReturnType<typeof labelRegions>, other: ReturnType<typeof labelRegions>, partners: Set<number>[]) => {
    partners.forEach((set, id) => {
      if (!significant(r, id)) return;
      if (!set.size) changes++;
      else if ([...set].filter(p => significant(other, p)).length > 1) changes++;
    });
  };
  check(a, b, partnersA);
  check(b, a, partnersB);
  return changes;
}
