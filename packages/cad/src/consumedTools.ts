import type { CadDocument } from './types';
import { isJoinedBody } from './extrudeSteps';

/** The parts used up as tools by "cut parts" steps that don't keep them: they cut, but aren't parts of their own. */
export function consumedTools(document: CadDocument): Set<string> {
  const consumed = new Set(
    (document.partCuts ?? [])
      // Split joints cut both boards; consuming either one would discard half of the joint.
      .filter(step => step.consumeTools && !step.split && !step.suppressed)
      .flatMap(step => step.tools.filter(tool => !tool.includes(':')))
  );
  // Consuming a host also uses up the active Add material that belongs to it.
  for (const part of document.parts) if (part.addTo && consumed.has(part.addTo) && isJoinedBody(document, part)) consumed.add(part.id);
  return consumed;
}
