const object = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
const text = (v: unknown, max = 256): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
const list = (v: unknown, limit: number, item: (v: unknown) => boolean, minimum = 0): boolean =>
  Array.isArray(v) && v.length >= minimum && v.length <= limit && Array.from(v).every(item);
const roles = (v: unknown) => list(v, 512, item => text(item));
const number = (v: unknown, zero = false) => typeof v === 'number' && Number.isFinite(v) && (zero ? v >= 0 : v > 0) && v <= 100_000;
const oneOf = (v: unknown, values: readonly string[]) => typeof v === 'string' && values.includes(v);
const axis = (v: unknown) => typeof v === 'string' && ['+x', '-x', '+y', '-y', '+z', '-z'].includes(v);
const unique = (values: unknown[], key: string) => new Set(values.map(v => (v as Record<string, unknown>)[key])).size === values.length;

/** Shape validation only. Dangling physical/source references need repair, not a refusal to reopen. */
export function constructionShapeIssue(input: unknown): string | undefined {
  if (input === undefined) return;
  const valid = list(input, 32, plan => {
    if (
      !object(plan, ['id', 'folderId', 'recipe', 'parameters', 'members', 'materials', 'connections', 'hardware', 'adhesive', 'assembly'])
    )
      return false;
    if (!text(plan.id) || !text(plan.folderId) || !oneOf(plan.recipe, ['panel-chair-keyed-v1', 'frame-stool-glued-v1'])) return false;
    if (!list(plan.parameters, 64, p => object(p, ['name', 'variableId']) && text(p.name) && text(p.variableId), 1)) return false;
    if (!unique(plan.parameters as unknown[], 'name')) return false;
    if (
      !list(
        plan.members,
        512,
        m => object(m, ['role', 'partId', 'copyId']) && text(m.role) && text(m.partId) && (m.copyId === undefined || text(m.copyId)),
        1
      )
    )
      return false;
    if (!unique(plan.members as unknown[], 'role')) return false;
    if (
      !list(
        plan.materials,
        64,
        m =>
          object(m, ['roles', 'kind', 'grain', 'stock', 'stockVariableId', 'service']) &&
          roles(m.roles) &&
          oneOf(m.kind, ['plywood', 'solid-wood']) &&
          oneOf(m.grain, ['profile-x', 'profile-y']) &&
          oneOf(m.stock, ['nominal', 'measured']) &&
          text(m.stockVariableId) &&
          m.service === 'conditioned-dry-interior',
        1
      )
    )
      return false;
    if (
      !list(
        plan.connections,
        512,
        c =>
          object(c, ['id', 'kind', 'roles', 'hardwareIds']) &&
          text(c.id) &&
          oneOf(c.kind, ['keyed-through-tenon', 'glued-shouldered-tenon', 'glued-lamination', 'seat-attachment']) &&
          roles(c.roles) &&
          roles(c.hardwareIds),
        1
      )
    )
      return false;
    if (!unique(plan.connections as unknown[], 'id')) return false;
    const dimensionKeys = [
      'diameter',
      'headDiameter',
      'headHeight',
      'washerDiameter',
      'washerThickness',
      'nutHeight',
      'minimumThreadProjection',
      'accessRadius',
      'accessLength',
    ];
    if (
      !list(plan.hardware, 512, h => {
        if (!object(h, ['id', 'kind', 'specification', 'holes', 'lengthVariableId', ...dimensionKeys, 'installation'])) return false;
        if (
          !list(
            h.holes,
            4,
            anchor =>
              object(anchor, ['purpose', 'role', 'sketchId', 'entityIds']) &&
              oneOf(anchor.purpose, ['clearance', 'pilot']) &&
              text(anchor.role) &&
              text(anchor.sketchId) &&
              list(anchor.entityIds, 16, item => text(item), 1) &&
              new Set(anchor.entityIds as string[]).size === (anchor.entityIds as string[]).length,
            1
          )
        )
          return false;
        const anchors = h.holes as { role: string; sketchId: string; entityIds: string[] }[];
        if (new Set(anchors.map(a => JSON.stringify([a.role, a.sketchId, [...a.entityIds].sort()]))).size !== anchors.length) return false;
        return (
          text(h.id) &&
          oneOf(h.kind, ['key-locking-bolt', 'seat-screw']) &&
          text(h.specification, 1000) &&
          text(h.lengthVariableId) &&
          dimensionKeys.every(k =>
            number(h[k], ['washerDiameter', 'washerThickness', 'nutHeight', 'minimumThreadProjection'].includes(k))
          ) &&
          oneOf(h.installation, ['head-washers-prevailing-torque-nut', 'pilot-and-drive-from-below'])
        );
      })
    )
      return false;
    if (!unique(plan.hardware as unknown[], 'id')) return false;
    if (
      plan.adhesive !== undefined &&
      !(
        object(plan.adhesive, ['kind', 'roles', 'preparation', 'clampingAndCure']) &&
        plan.adhesive.kind === 'PVA-wood-glue' &&
        roles(plan.adhesive.roles) &&
        text(plan.adhesive.preparation, 2000) &&
        text(plan.adhesive.clampingAndCure, 2000)
      )
    )
      return false;
    return list(
      plan.assembly,
      128,
      s =>
        object(s, ['action', 'roles', 'hardwareIds', 'axis', 'moving']) &&
        oneOf(s.action, [
          'bond-laminations',
          'insert-crosspieces',
          'fit-second-side',
          'install-keys',
          'install-hardware',
          'square-and-cure',
          'attach-seat',
        ]) &&
        roles(s.roles) &&
        roles(s.hardwareIds) &&
        axis(s.axis) &&
        // Moving roles are some of the step's own roles, each once.
        (s.moving === undefined ||
          (list(s.moving, 512, item => text(item) && (s.roles as unknown[]).includes(item), 1) &&
            new Set(s.moving as string[]).size === (s.moving as string[]).length)),
      1
    );
  });
  if (!valid || !unique(input as unknown[], 'id')) return 'Invalid CAD construction plans';
}
