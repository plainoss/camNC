import { createCadDocument, type DesignStep } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { filteredFeatureRows, parseFeatureFilter, partMatchesFilter, type FilterRow } from './featureFilter';

const step = (id: string, kind: DesignStep['kind'], label: string, extra: Partial<DesignStep> = {}): FilterRow => ({
  key: id,
  kind: 'step',
  label,
  step: { id, kind, label, partId: 'p', ...extra },
});
const rows: FilterRow[] = [
  step('s1', 'sketch', 'Sketch 1', {}),
  { key: 'thick', kind: 'variable', label: '#thick = 30 mm', variable: 'thick' },
  step('e1', 'extrude', 'Extrude 1'),
  { key: 'test', kind: 'variable', label: '#test = 4', variable: 'test' },
  step('s2', 'sketch', 'Sketch 2', { suppressed: true }),
  step('e2', 'extrude', 'Extrude 2', { broken: 'Overlapping fillets.' }),
];
const kept = (text: string) => {
  const found = filteredFeatureRows(createCadDocument(), rows, text);
  return found && rows.filter(row => found.has(row.key)).map(row => row.label);
};

describe('the Feature list filter', () => {
  it('reads a keyword and the words after it, or a bare word', () => {
    expect(parseFeatureFilter('  ')).toBeNull();
    expect(parseFeatureFilter(':variable thick')).toEqual({ keyword: 'variable', term: 'thick' });
    expect(parseFeatureFilter('Extrude')).toEqual({ keyword: null, term: 'Extrude' });
  });

  it('keeps rows by name or type for a bare word, and by what a keyword says', () => {
    expect(kept('extrude')).toEqual(['Extrude 1', 'Extrude 2']);
    expect(kept('thick')).toEqual(['#thick = 30 mm']);
    expect(kept(':type variable')).toEqual(['#thick = 30 mm', '#test = 4']);
    expect(kept(':suppressed')).toEqual(['Sketch 2']);
    expect(kept(':errors')).toEqual(['Extrude 2']);
    // A keyword alone with nothing to narrow keeps everything.
    expect(kept(':variable')).toBeNull();
    expect(kept('')).toBeNull();
  });

  it('narrows the Parts list by the part’s own name only', () => {
    expect(partMatchesFilter('Part 1', 'Extrude')).toBe(false);
    expect(partMatchesFilter('Part 1', 'part')).toBe(true);
    expect(partMatchesFilter('Shelf', ':part shelf')).toBe(true);
    expect(partMatchesFilter('Shelf', ':variable')).toBe(true);
    expect(partMatchesFilter('Shelf', '')).toBe(true);
  });
});
