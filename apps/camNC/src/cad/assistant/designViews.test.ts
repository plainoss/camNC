import { createPlateDocument, evaluateCadDocument } from '@wbcnc/cad';
import { renderCadViews } from '@wbcnc/cad-script';
import { expect, it } from 'vitest';
import { normalizeAssistantViews, renderAssistantViews } from './designViews';

it('normalizes boolean compatibility and preserves explicit bounded view order', () => {
  expect(normalizeAssistantViews(undefined)).toEqual([]);
  expect(normalizeAssistantViews(false)).toEqual([]);
  expect(normalizeAssistantViews(true)).toEqual(['top', 'front', 'right']);
  expect(normalizeAssistantViews([])).toEqual([]);
  const supplied = ['right', 'top'];
  const result = normalizeAssistantViews(supplied);
  supplied.push('front');
  expect(result).toEqual(['right', 'top']);
  expect(Object.isFrozen(result)).toBe(true);
});

it('refuses unknown, duplicate, oversized or executable view selections', () => {
  for (const input of [null, 'top', {}, ['left'], ['top', 'top'], ['top', 'front', 'right', 'top'], Array(1)])
    expect(() => normalizeAssistantViews(input)).toThrow();
  const accessor = Object.defineProperty(['top'], '0', {
    enumerable: true,
    get() {
      throw new Error('must not run');
    },
  });
  expect(() => normalizeAssistantViews(accessor)).toThrow(/JSON data/);
  expect(() =>
    normalizeAssistantViews(
      Object.assign(['top'], {
        toJSON() {
          throw new Error('must not run');
        },
      })
    )
  ).toThrow(/JSON array/);
});

it('renders only selected real projections with unchanged bounds and legacy all-three behavior', () => {
  const document = createPlateDocument();
  const { parts } = evaluateCadDocument(document);
  const all = renderCadViews(document, parts);
  expect(all.map(view => view.name)).toEqual(['top', 'front', 'right']);
  expect(renderAssistantViews(document, parts, ['right', 'top'])).toEqual([all[2], all[0]]);
  expect(renderAssistantViews(document, parts, true)).toEqual(all);
  expect(renderAssistantViews(document, parts, false)).toEqual([]);
  // No selection must skip geometry access entirely, rather than rendering and discarding three SVGs.
  const unreadable = Object.defineProperty({}, 'parts', {
    get() {
      throw new Error('unrequested geometry');
    },
  });
  expect(renderAssistantViews(unreadable as typeof document, [], [])).toEqual([]);
});
