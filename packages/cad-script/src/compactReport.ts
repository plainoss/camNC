import { cadFaceSketches, designSteps, patternMaster, type CadDocument } from '@wbcnc/cad';
import { shortHandles, type CadReport } from './inspect';
import { reportPrefix } from './reportGeometry';

/** A model-facing report groups pattern instances; the full report and evaluated geometry retain every instance. */
export function compactCadReport(document: CadDocument, report: CadReport) {
  const partHandles = shortHandles(document.parts.map(part => part.id));
  const steps = designSteps(reportPrefix(document));
  const stepHandles = shortHandles(steps.map(step => step.id));
  return {
    ...report,
    featureList: steps.map(({ id, partId, ...step }) => ({
      ...step,
      ref: stepHandles.get(id)!,
      part: document.parts.find(part => part.id === partId)?.name ?? partId,
    })),
    parts: report.parts.map((entry, index) => {
      const part = document.parts[index]!;
      const sketches = [part.sketch, ...cadFaceSketches(part).map(face => face.sketch)];
      const cuts = new Map<string, (typeof entry.cuts)[number] & { count?: number; lastAt?: number[] }>();
      for (const cut of entry.cuts) {
        const key = cut.ref.split('~')[0]!;
        const first = cuts.get(key);
        if (first) cuts.set(key, { ...first, count: (first.count ?? 1) + 1, lastAt: cut.at });
        else cuts.set(key, cut);
      }
      return {
        ...entry,
        ref: partHandles.get(part.id)!,
        cuts: [...cuts.values()],
        sketches: entry.sketches.map((sketch, i) => {
          const source = sketches[i]!;
          const handles = shortHandles(source.entities.map(entity => entity.id));
          const replicas = new Set(
            source.constraints.flatMap(constraint => {
              if (constraint.type !== 'linearPattern' && constraint.type !== 'circularPattern') return [];
              const master = patternMaster(constraint);
              return constraint.instances
                .filter(instance => instance !== master)
                .flatMap(instance => instance.activeIds.map(id => handles.get(id)));
            })
          );
          return { ...sketch, entities: sketch.entities.filter(entity => !replicas.has(entity.ref)) };
        }),
      };
    }),
    ...(report.steps && { steps: report.steps.map(step => (step.kind === 'pattern' ? { ...step, copies: step.copies.length } : step)) }),
  };
}
