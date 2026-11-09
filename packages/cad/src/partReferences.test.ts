import { describe, expect, it } from 'vitest';
import { createCadDocument, createCadPart } from './document';
import { designSteps } from './designSteps';
import { cadPartReference, cadPartReferenceMatches, cadPartReferenceName } from './partReferences';
import type { CadDocument } from './types';

describe('physical part references', () => {
  const source = createCadPart('Divider');
  source.copies = [{ id: 'manual', name: 'Spare' }, { id: 'pattern:1' }, { id: 'pattern:2', name: 'Third divider' }];
  const document: CadDocument = { ...createCadDocument(), parts: [createCadPart('Base'), source] };
  it('resolves named and generated copies without truncating their slot IDs', () => {
    expect(cadPartReferenceName(document, source.id)).toBe('Divider');
    expect(cadPartReferenceName(document, cadPartReference(source.id, 'manual'))).toBe('Spare');
    expect(cadPartReferenceName(document, cadPartReference(source.id, 'pattern:1'))).toBe('Divider 3');
    expect(cadPartReferenceName(document, cadPartReference(source.id, 'pattern:2'))).toBe('Third divider');
    expect(cadPartReferenceName(document, cadPartReference(source.id, 'pattern:9'))).toBeNull();
  });
  it('distinguishes the source family from one exact physical copy', () => {
    const selected = cadPartReference(source.id, 'pattern:2');
    expect(cadPartReferenceMatches([selected], source.id)).toBe(false);
    expect(cadPartReferenceMatches([selected], source.id, 'pattern:1')).toBe(false);
    expect(cadPartReferenceMatches([selected], source.id, 'pattern:2')).toBe(true);
    expect(cadPartReferenceMatches([source.id], source.id, 'pattern:2')).toBe(true);
  });
  it('keeps the selected copy visible in the saved feature label', () => {
    source.pattern = { id: 'pattern', axis: 'x', count: 3, spacing: 80 };
    document.partCuts = [
      { id: 'housing', tools: [cadPartReference(source.id, 'pattern:2')], targets: [document.parts[0]!.id], clearance: 0 },
    ];
    expect(designSteps(document).find(step => step.partCutId === 'housing')?.label).toBe('Cut Base with Third divider');
    const steps = designSteps(document);
    expect(steps.findIndex(step => step.partCutId === 'housing')).toBeGreaterThan(steps.findIndex(step => step.id === 'pattern'));
  });
});
