/** These sibling source features need their real evaluators, even when combined with a supported higher floor. */
export function unsupportedCadSourceIssue(document: object): string | null {
  const source = document as Record<string, unknown>;
  if (['operationOrder', 'copyTransforms', 'legacyPartCutIds'].some(key => source[key] !== undefined))
    return 'This reader does not support ordered physical-copy operations.';
  if (source.constructions !== undefined) return 'This reader does not support furniture construction declarations.';
  return null;
}
