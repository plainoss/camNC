type Data = Record<string, unknown>;
const record = (value: unknown): Data => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {});
const rows = (value: unknown): Data[] => (Array.isArray(value) ? value.map(record) : []);

function brief(part: Data, body?: Data): Data {
  return {
    name: part.name,
    ref: part.ref,
    thickness: part.thickness,
    outline: record(part.outline).size,
    ...(part.holes ? { holes: part.holes } : {}),
    ...(part.notches ? { notches: part.notches } : {}),
    ...(rows(part.cuts).length && {
      cuts: rows(part.cuts).map(cut => ({
        ref: cut.ref,
        depth: cut.through ? 'through' : cut.to,
        size: cut.size,
        ...(cut.count ? { count: cut.count } : {}),
      })),
    }),
    ...(body && { at: body.at, size: body.size }),
  };
}
const signature = (part: Data, body?: Data) => JSON.stringify(brief({ ...part, ref: undefined }, body));

/** Check result for the model: verdict, diagnostics and only the parts this script added or changed. */
export function compactCheckReport(checked: unknown, initial: unknown): Data {
  const report = record(checked),
    before = record(initial);
  const bodies = new Map(rows(record(report.assembly).parts).map(body => [body.name, body]));
  const oldBodies = new Map(rows(record(before.assembly).parts).map(body => [body.name, body]));
  const oldParts = new Map(rows(before.parts).map(part => [part.name, part]));
  const parts = rows(report.parts);
  const changed = parts.filter(part => {
    const old = oldParts.get(part.name);
    return !old || signature(old, oldBodies.get(String(old.name))) !== signature(part, bodies.get(String(part.name)));
  });
  const names = new Set(parts.map(part => part.name));
  const all = [...bodies.values()];
  const size = all.length
    ? [0, 1, 2].map(axis => {
        const at = (body: Data) => (body.at as number[])[axis]!,
          extent = (body: Data) => at(body) + (body.size as number[])[axis]!;
        return Math.round((Math.max(...all.map(extent)) - Math.min(...all.map(at))) * 100) / 100;
      })
    : undefined;
  return {
    ok: report.ok,
    status: report.status,
    errors: report.errors,
    warnings: report.warnings,
    ...(size && { overallSize: size }),
    changedParts: changed.map(part => brief(part, bodies.get(String(part.name)))),
    ...(changed.length < parts.length && { unchangedParts: parts.length - changed.length }),
    ...([...oldParts.keys()].some(name => !names.has(name)) && { removedParts: [...oldParts.keys()].filter(name => !names.has(name)) }),
    detail: 'Compact result. Use read_design_report (summary, parts, featureList, assembly, steps) or a part name for full data.',
  };
}
