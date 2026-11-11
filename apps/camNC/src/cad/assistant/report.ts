type RecordData = Record<string, unknown>;
const record = (value: unknown): RecordData => (value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordData) : {});
const rows = (value: unknown): RecordData[] => (Array.isArray(value) ? value.map(record) : []);

export interface AssistantReportScope {
  partId?: string;
  partName?: string;
}

function matches(part: RecordData, name?: string, id?: string): boolean {
  return !!((name && part.name === name) || (id && (part.id === id || (typeof part.ref === 'string' && id.startsWith(part.ref)))));
}

/** Keep global diagnostics and cuts even when a selected part scopes the detailed sketch geometry. */
export function summarizeAssistantReport(input: unknown, scope: AssistantReportScope = {}): RecordData {
  const report = record(input);
  const { parts, featureList, steps, assembly, ...diagnostics } = report;
  return {
    ...diagnostics,
    parts: rows(parts).map(part => {
      if (matches(part, scope.partName, scope.partId)) return part;
      const { sketches, toolpaths, ...material } = part;
      const toolpath = record(toolpaths);
      return {
        ...material,
        sketches: rows(sketches).map(({ entities: _entities, ...summary }) => summary),
        ...(toolpaths ? { toolpaths: { warnings: toolpath.warnings, blocked: toolpath.blocked } } : {}),
      };
    }),
    ...(featureList ? { featureList } : {}),
    // Placements, collisions and joint openings are needed to judge edits outside the selected part.
    ...(steps ? { steps } : {}),
    ...(assembly ? { assembly } : {}),
    detail: 'Sketch entities and operation detail omitted outside the selected part. Use read_design_report for exact sections or a part.',
  };
}

export const assistantReportSections = ['summary', 'parts', 'featureList', 'assembly', 'steps', 'errors', 'warnings'] as const;

export function readAssistantReport(input: unknown, options: { section?: string; part?: string } = {}): unknown {
  const report = record(input);
  if (options.part) {
    const parts = rows(report.parts).filter(part => matches(part, options.part, options.part));
    return parts.length
      ? { parts, errors: report.errors, warnings: report.warnings }
      : { error: 'Part not found. Use its exact name or report handle.' };
  }
  const section = options.section ?? 'summary';
  if (section === 'summary') return summarizeAssistantReport(input);
  if ((assistantReportSections as readonly string[]).includes(section)) return report[section] ?? [];
  return { error: `Unknown report section. Available: ${assistantReportSections.join(', ')}. Or request part by name/handle.` };
}
