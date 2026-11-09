import type { CadDocument } from './types';

/** The parts used up as tools by "cut parts" steps that don't keep them: they cut, but aren't parts of their own. */
export function consumedTools(document: CadDocument): Set<string> {
  return new Set(
    (document.partCuts ?? [])
      .filter(step => step.consumeTools && !step.suppressed)
      .flatMap(step => step.tools.filter(tool => !tool.includes(':')))
  );
}
