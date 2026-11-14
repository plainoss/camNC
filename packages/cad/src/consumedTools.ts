import type { CadDocument } from './types';
import { isJoinedBody } from './extrudeSteps';
import { mergedWithAll, unionOf } from './unionParts';

/** The parts used up as tools by "cut parts" steps that don't keep them: they cut, but aren't parts of their own. */
export function consumedTools(document: CadDocument): Set<string> {
  const consumed = new Set(
    (document.partCuts ?? [])
      // Split joints cut both boards; consuming either one would discard half of the joint.
      // A union that can't join its parts leaves them as they are.
      .filter(
        step =>
          step.consumeTools &&
          !step.split &&
          !step.suppressed &&
          (step.operation === 'subtract' || !step.operation || 'part' in unionOf(document, step))
      )
      .flatMap(step => step.tools.filter(tool => !tool.includes(':')))
  );
  // An Add merged with all it runs into is part of the first of them, and so are the others.
  for (const part of document.parts) {
    const merged = mergedWithAll(document, part);
    if (merged && 'part' in merged.made) for (const id of merged.joined) consumed.add(id);
  }
  // Consuming a host also uses up the active Add material that belongs to it.
  for (const part of document.parts) if (part.addTo && consumed.has(part.addTo) && isJoinedBody(document, part)) consumed.add(part.id);
  return consumed;
}
