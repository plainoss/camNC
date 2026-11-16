/** A triangle mesh in mm: three coordinates per vertex, three vertex indices per triangle, outward winding. */
export interface FingerprintMesh {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

export type Vec3 = [number, number, number];

export interface Bbox {
  min: Vec3;
  max: Vec3;
}

/** What a solid is, independent of the program that wrote it: sizes in mm, mm², mm³. */
export interface PartFingerprint {
  name: string;
  volume: number;
  area: number;
  bbox: Bbox;
  /** Sum over the connected shells of (2 - χ) / 2; a plate is 0, a plate with one through hole 1. */
  genus: number;
  /** Every edge, after welding, is shared by exactly two triangles. */
  closed: boolean;
  triangles: number;
}

export function vertex(mesh: FingerprintMesh, i: number): Vec3 {
  const p = mesh.positions;
  return [p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!];
}

export function meshBbox(mesh: FingerprintMesh): Bbox {
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  // Only vertices a triangle uses: a reader can leave unused ones behind.
  for (let t = 0; t < mesh.indices.length; t++) {
    const v = vertex(mesh, mesh.indices[t]!);
    for (let axis = 0; axis < 3; axis++) {
      if (v[axis]! < min[axis]!) min[axis] = v[axis]!;
      if (v[axis]! > max[axis]!) max[axis] = v[axis]!;
    }
  }
  return { min, max };
}

/** Twice the triangle's area, as its normal vector. */
export function triangleNormal2A(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const,
    v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

/** Volume by signed tetrahedra to the origin (negative for a solid inside out), area by triangle sum. */
export function volumeAndArea(mesh: FingerprintMesh) {
  let volume = 0,
    area = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = vertex(mesh, mesh.indices[t]!),
      b = vertex(mesh, mesh.indices[t + 1]!),
      c = vertex(mesh, mesh.indices[t + 2]!);
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    area += Math.hypot(...triangleNormal2A(a, b, c)) / 2;
  }
  return { volume, area };
}

/**
 * One id per vertex, the same for vertices within `tolerance` of each other. Readers repeat a vertex for each face it
 * is on, so the topology only shows once they're welded. The neighbouring grid cells are searched too, so two points
 * on either side of a cell boundary still weld.
 */
export function weldVertices(mesh: FingerprintMesh, tolerance: number): Int32Array {
  const count = mesh.positions.length / 3,
    ids = new Int32Array(count),
    kept: Vec3[] = [],
    grid = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const v = vertex(mesh, i),
      [cx, cy, cz] = v.map(c => Math.floor(c / tolerance)) as Vec3;
    let found = -1;
    for (let x = cx - 1; x <= cx + 1 && found < 0; x++)
      for (let y = cy - 1; y <= cy + 1 && found < 0; y++)
        for (let z = cz - 1; z <= cz + 1 && found < 0; z++)
          found = grid.get(`${x},${y},${z}`)?.find(k => kept[k]!.every((c, axis) => Math.abs(c - v[axis]!) <= tolerance)) ?? -1;
    if (found < 0) {
      found = kept.push(v) - 1;
      const key = `${cx},${cy},${cz}`;
      const list = grid.get(key);
      if (list) list.push(found);
      else grid.set(key, [found]);
    }
    ids[i] = found;
  }
  return ids;
}

/** Genus and closedness from the Euler characteristic V - E + F of each connected shell, after welding. */
export function meshTopology(mesh: FingerprintMesh, tolerance: number): { genus: number; closed: boolean } {
  const ids = weldVertices(mesh, tolerance);
  const parent = new Map<number, number>();
  const find = (v: number): number => {
    let root = v;
    while (parent.get(root)! !== root) root = parent.get(root)!;
    // Path compression keeps the shells' trees flat on meshes with many triangles.
    for (let next = v; next !== root; ) {
      const up = parent.get(next)!;
      parent.set(next, root);
      next = up;
    }
    return root;
  };
  const edges = new Map<string, number>(),
    faces: [number, number, number][] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const f: [number, number, number] = [ids[mesh.indices[t]!]!, ids[mesh.indices[t + 1]!]!, ids[mesh.indices[t + 2]!]!];
    // A triangle whose corners weld together has no area and no edges.
    if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) continue;
    faces.push(f);
    for (const v of f) if (!parent.has(v)) parent.set(v, v);
    for (let k = 0; k < 3; k++) {
      const a = f[k]!,
        b = f[(k + 1) % 3]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
      const ra = find(a),
        rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }
  }
  const shells = new Map<number, { v: number; e: number; f: number }>();
  const shell = (v: number) => {
    const root = find(v);
    return shells.get(root) ?? shells.set(root, { v: 0, e: 0, f: 0 }).get(root)!;
  };
  for (const v of parent.keys()) shell(v).v++;
  for (const f of faces) shell(f[0]).f++;
  let closed = true;
  for (const [key, uses] of edges) {
    if (uses !== 2) closed = false;
    shell(Number(key.slice(0, key.indexOf(',')))).e++;
  }
  let genus = 0;
  for (const { v, e, f } of shells.values()) genus += (2 - (v - e + f)) / 2;
  return { genus, closed };
}

/** The fingerprint of one solid. Vertices weld within 1e-6 of its bbox diagonal. */
export function fingerprintMesh(name: string, mesh: FingerprintMesh): PartFingerprint {
  const bbox = meshBbox(mesh);
  const diagonal = Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]);
  const { volume, area } = volumeAndArea(mesh);
  const { genus, closed } = meshTopology(mesh, Math.max(diagonal, 1) * 1e-6);
  return { name, volume, area, bbox, genus, closed, triangles: mesh.indices.length / 3 };
}
