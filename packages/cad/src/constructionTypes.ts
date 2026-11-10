/** A physical member: a source instance or one exact copy, never an entire family. */
export interface CadConstructionMember {
  role: string;
  partId: string;
  copyId?: string;
}

export interface CadConstructionMaterial {
  roles: string[];
  kind: 'plywood' | 'solid-wood';
  /** In the member's local profile frame, including its actual copy placement. */
  grain: 'profile-x' | 'profile-y';
  stock: 'nominal' | 'measured';
  stockVariableId: string;
  service: 'conditioned-dry-interior';
}

/** Purchased hardware is not a CAD blank and must never enter stock CAM. */
export interface CadConstructionHardware {
  id: string;
  kind: 'key-locking-bolt' | 'seat-screw';
  specification: string;
  /** Stable authored geometry; world location/axis are derived again after edits. */
  hole: { role: string; sketchId: string; entityIds: string[] };
  lengthVariableId: string;
  diameter: number;
  headDiameter: number;
  headHeight: number;
  washerDiameter: number;
  washerThickness: number;
  /** Zero for a wood screw. A key-locking bolt requires a prevailing-torque nut. */
  nutHeight: number;
  minimumThreadProjection: number;
  /** Required unobstructed installation space, measured at both applicable ends. */
  accessRadius: number;
  accessLength: number;
  installation: 'head-washers-prevailing-torque-nut' | 'pilot-and-drive-from-below';
}

export interface CadConstructionConnection {
  id: string;
  kind: 'keyed-through-tenon' | 'glued-shouldered-tenon' | 'glued-lamination' | 'seat-attachment';
  roles: string[];
  hardwareIds: string[];
}

export interface CadConstructionAssemblyStep {
  action:
    | 'bond-laminations'
    | 'insert-crosspieces'
    | 'fit-second-side'
    | 'install-keys'
    | 'install-hardware'
    | 'square-and-cure'
    | 'attach-seat';
  roles: string[];
  hardwareIds: string[];
  /** A stated insertion/tool-access direction, not evidence that its sweep is clear. */
  axis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
}

/**
 * Durable construction intent for bounded, versioned furniture recipes. Neither
 * these declarations nor a passing geometry check establish a material capacity.
 * Missing references remain editable; derived construction diagnostics reject
 * completion until actual members, features, fit and assembly agree again.
 */
export interface CadConstruction {
  id: string;
  folderId: string;
  recipe: 'panel-chair-keyed-v1' | 'frame-stool-glued-v1';
  parameters: { name: string; variableId: string }[];
  members: CadConstructionMember[];
  materials: CadConstructionMaterial[];
  connections: CadConstructionConnection[];
  hardware: CadConstructionHardware[];
  adhesive?: {
    kind: 'PVA-wood-glue';
    roles: string[];
    preparation: string;
    clampingAndCure: string;
  };
  assembly: CadConstructionAssemblyStep[];
}
