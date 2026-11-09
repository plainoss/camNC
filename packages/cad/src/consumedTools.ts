import type { CadDocument } from './types';

/** The parts used up as tools by "cut parts" steps that don't keep them: they cut, but aren't parts of their own. */
export function consumedTools(document: CadDocument): Set<string> {
  return new Set(
    (document.partCuts ?? [])
      // Split joints cut both boards; consuming either one would discard half of the joint.
      .filter(step => step.consumeTools && !step.split && !step.suppressed)
      .flatMap(step => step.tools.filter(tool => !tool.includes(':')))
  );
}
