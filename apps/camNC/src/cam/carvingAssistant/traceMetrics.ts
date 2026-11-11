export interface TraceCoverage {
  intersectionOverUnion: number;
  removedFraction: number;
  addedFraction: number;
  /** Largest nearest-boundary distance in either direction; Infinity when a boundary has no counterpart in range. */
  boundaryErrorPx: number;
  /**
   * Boundary distance that 99.9% of boundary pixels stay within. The tip of a light gap that narrows below a pixel
   * closes when traced and has no counterpart nearby; topology and coverage still catch any lost feature.
   */
  typicalBoundaryErrorPx: number;
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

/** Raster coverage and two-way nearest-boundary comparison on the complete bounded tracing grid. */
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
  const distances: number[] = [];
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
      distances.push(nearest ? nearest.distance : Infinity);
    }
  distances.sort((p, q) => p - q);
  return {
    intersectionOverUnion: shared / Math.max(1, original + added),
    removedFraction: removed / Math.max(1, original),
    addedFraction: added / Math.max(1, original),
    boundaryErrorPx: distances.length ? distances[distances.length - 1] : 0,
    typicalBoundaryErrorPx: distances.length ? distances[Math.floor((distances.length - 1) * 0.999)] : 0,
  };
}
