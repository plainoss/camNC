import { act, cleanup, renderHook } from '@testing-library/react';
import { createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';
import { afterEach, expect, it, vi } from 'vitest';
import { usePartCutSelection } from './usePartCutSelection';
afterEach(cleanup);

it.each(['copy', 'pattern', 'body', 'consumed'] as const)(
  'does not prefill a %s-suppressed copy and restores the same identity when active',
  kind => {
    const part = createCadPart('Divider'),
      base = createCadPart('Base');
    part.pattern = { id: 'pattern', axis: 'x', count: 3, spacing: 80 };
    part.copies = [
      { id: 'pattern:1', pattern: 'pattern' },
      { id: 'pattern:2', pattern: 'pattern' },
    ];
    const source: CadDocument = { ...createCadDocument(), parts: [part, base] };
    const { result, rerender } = renderHook(document => usePartCutSelection(document, document.parts[0], vi.fn()), {
      initialProps: source,
    });
    act(() => result.current.selectPart(part.id, 'pattern:2'));
    expect(result.current.selectedTool).toBe(`${part.id}:pattern:2`);
    const hidden = structuredClone(source),
      target = hidden.parts[0]!;
    if (kind === 'copy') target.copies![1]!.suppressed = true;
    else if (kind === 'pattern') target.pattern!.suppressed = true;
    else if (kind === 'body') target.suppressed = true;
    else hidden.partCuts = [{ id: 'consume', tools: [part.id], targets: [base.id], consumeTools: true, clearance: 0 }];
    rerender(hidden);
    expect(target.copies![1]!.id).toBe('pattern:2');
    expect(result.current.selectedTool).toBeUndefined();
    expect(result.current.selectedKey).toBeUndefined();
    rerender(source);
    expect(result.current.selectedTool).toBe(`${part.id}:pattern:2`);
    expect(result.current.selectedKey).toBe(`${part.id}/pattern:2`);
  }
);
