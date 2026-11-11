/**
 * Temporary partial-reader guard until the actual upstream evaluators are
 * integrated: a larger number must never authorize silently ignored semantics.
 * Ordered operations own floor 4; per-step relief owns floor 5; construction owns
 * floor 6. Remove a guard only together with its supported implementation.
 */
export function unsupportedFurnitureSource(input: object): string | undefined {
  const source = input as Record<string, unknown>;
  if (['copyTransforms', 'operationOrder', 'legacyPartCutIds'].some(key => source[key] !== undefined))
    return 'This reader does not yet support ordered physical operations.';
  if (Array.isArray(source.partCuts) && source.partCuts.some(step => step && typeof step === 'object' && (step as Record<string, unknown>).cornerRelief !== undefined))
    return 'This reader does not yet support per-Cut parts corner relief.';
}
