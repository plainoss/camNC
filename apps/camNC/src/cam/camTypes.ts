import type { PartSummary } from '@wbcnc/cam';

/** Closed polygons as [x, y] point lists, in the part's flat frame (mm). */
export type Outline2D = [number, number][][];

/** One part to make: a group of identical bodies, laid flat (Z up, Z0 = bottom face). */
export interface CamPartInfo {
  /** Permanent native loop identities, aligned with shape.holes and the CAM through-hole order. */
  holeIds?: string[];
  /** Original sketch bounding-box origin, before normalization for nesting (native CAD only). */
  sourceOrigin?: [number, number];
  /** Stable for the same model file: `part-<n>` in import order. */
  id: string;
  /** The job's name for the part: the model's, unless the user renamed it (see `withPartNames`). */
  name: string;
  /** The name in the model file, before any rename. */
  modelName?: string;
  /** One name per identical body, as shown on every step and in the G-code; the quantity is names.length. */
  names: string[];
  size: [number, number, number];
  thickness: number;
  summary: PartSummary;
  /** Top view for the nesting view. */
  shape: { outlines: Outline2D; holes: Outline2D; pockets: { depth: number; region: Outline2D }[] };
}

/** A body for display, in the model's coordinates; `flat` (column-major 4x4) lays it flat. */
export interface BodyMesh {
  name: string;
  partId: string;
  positions: Float32Array;
  indices: Uint32Array;
  flat: number[];
}

export interface ModelImport {
  parts: CamPartInfo[];
  meshes: BodyMesh[];
  readMs: number;
  analyzeMs: number;
}

export type { BoardRequest, OpSummary, PlanResult, ReleaseProgram } from '@wbcnc/cam';
