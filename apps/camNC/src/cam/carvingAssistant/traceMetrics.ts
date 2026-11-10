export interface TraceCoverage {
  intersectionOverUnion: number;
  removedFraction: number;
  addedFraction: number;
  boundaryErrorPx: number;
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

/** Remove only isolated dark specks below a physical area threshold; never fill light holes automatically. */
export function removeTraceSpecks(ink: Uint8Array, width: number, maxAreaPixels: number): { components: number; pixels: number } {
  const visited = new Uint8Array(ink.length),
    queue = new Uint32Array(ink.length);
  let components = 0,
    pixels = 0;
  for (let first = 0; first < ink.length; first++) {
    if (!ink[first] || visited[first]) continue;
    let end = 1;
    queue[0] = first;
    visited[first] = 1;
    for (let at = 0; at < end; at++) {
      const i = queue[at];
      for (const next of [i % width ? i - 1 : -1, i % width < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (next >= 0 && next < ink.length && ink[next] && !visited[next]) {
          visited[next] = 1;
          queue[end++] = next;
        }
      }
    }
    if (end >= maxAreaPixels) continue;
    components++;
    pixels += end;
    for (let at = 0; at < end; at++) ink[queue[at]] = 0;
  }
  return { components, pixels };
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
  let error = 0;
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
      if (!nearest)
        return {
          intersectionOverUnion: shared / Math.max(1, original + added),
          removedFraction: removed / Math.max(1, original),
          addedFraction: added / Math.max(1, original),
          boundaryErrorPx: Infinity,
        };
      error = Math.max(error, nearest.distance);
    }
  return {
    intersectionOverUnion: shared / Math.max(1, original + added),
    removedFraction: removed / Math.max(1, original),
    addedFraction: added / Math.max(1, original),
    boundaryErrorPx: error,
  };
}
