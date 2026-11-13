import { setPartPattern, type CadDocument, type CadPartPattern } from '@wbcnc/cad';
import { circularPartPatternStart } from './circularPartPatternStart';

export type PartPatternKind = 'linear' | 'circular';
/** How a pattern dialog opens: a kind for the Pattern dialog, or the Linear pattern command's own dialog. */
export type PatternOpening = PartPatternKind | 'linearPattern';

/** The same conversion whether a kind is chosen in the dialog or explicitly in tool search. */
export function partPatternForKind(
  kind: PartPatternKind,
  current: CadPartPattern | undefined,
  initiallyPatterned: boolean
): Omit<CadPartPattern, 'id'> {
  const fresh =
    !initiallyPatterned &&
    current?.count === 2 &&
    current.spacing === 100 &&
    current.axis === 'x' &&
    !current.countExpression &&
    !current.spacingExpression &&
    !current.direction &&
    !current.vector;
  return kind === 'circular'
    ? circularPartPatternStart(fresh ? undefined : current)
    : {
        axis: current?.axis ?? 'x',
        count: current?.count ?? 2,
        spacing: current?.spacing ?? 100,
        ...(current?.suppressed && { suppressed: current.suppressed }),
        ...(current?.countExpression && { countExpression: current.countExpression }),
      };
}

/** Initialize only the local preview; an existing same-kind pattern needs no normalization or source edit. */
export function studioPatternDraft(document: CadDocument, partId: string, kind?: PartPatternKind): CadDocument {
  const part = document.parts.find(part => part.id === partId);
  if (!kind || !part || (part.pattern?.circular ? 'circular' : 'linear') === kind) return document;
  return setPartPattern(document, partId, partPatternForKind(kind, part.pattern, !!part.pattern));
}
