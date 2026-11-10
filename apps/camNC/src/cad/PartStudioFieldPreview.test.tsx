import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { CadThicknessField } from './CadThicknessField';
import { CadDrawnOnField } from './CadDrawnOnField';
import { CadPartPatternField } from './CadPartPatternField';
import { CadReliefField } from './CadReliefField';
import { ExtrudeDialog } from './ExtrudeDialog';
import { HoleDialog } from './HoleDialog';

afterEach(cleanup);
const edit = (name: string, value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: new RegExp(`^${name}(?:mm)?$`) }), { target: { value } });

it('previews valid thickness drafts without blurring or rewriting the text', () => {
  const change = vi.fn();
  function Host() {
    const [value, setValue] = useState(18);
    const [expression, setExpression] = useState<string>();
    return (
      <CadThicknessField
        livePreview
        value={value}
        expression={expression}
        onCommit={(next, text) => {
          change(next, text);
          setValue(next);
          setExpression(text);
        }}
      />
    );
  }
  render(<Host />);
  edit('Thickness', '2cm');
  expect(change).toHaveBeenLastCalledWith(20, '2cm');
  expect(screen.getByRole('textbox', { name: 'Thickness' })).toHaveValue('2cm');
  change.mockClear();
  edit('Thickness', '2cm+');
  expect(change).not.toHaveBeenCalled();
});

it('previews extrusion offsets as soon as valid text is entered', () => {
  const document = createPlateDocument();
  const part = { ...document.parts[0]!, drawnOn: { on: { plane: 'top' as const }, offset: 0 } };
  const change = vi.fn();
  render(<CadDrawnOnField livePreview document={document} part={part} onChange={change} />);
  edit('Offset', '12');
  expect(change).toHaveBeenLastCalledWith({ on: { plane: 'top' }, offset: 12 });
});

it('previews pattern count and spacing while each field is being edited', () => {
  const change = vi.fn();
  render(<CadPartPatternField ready pattern={{ id: 'pattern', axis: 'x', count: 2, spacing: 100 }} onChange={change} />);
  edit('How many', '4');
  expect(change).toHaveBeenLastCalledWith({ axis: 'x', count: 4, spacing: 100 });
  edit('Spacing', '24');
  expect(change).toHaveBeenLastCalledWith({ axis: 'x', count: 4, spacing: 24 });
});

it('previews the corner relief diameter while editing', () => {
  const change = vi.fn();
  render(<CadReliefField livePreview relief={{ diameter: 6 }} onChange={change} />);
  edit('for a bit of', '8');
  expect(change).toHaveBeenLastCalledWith({ diameter: 8 });
});

it.each(['thin', 'remove'] as const)('previews %s extrusion depth while editing', mode => {
  const document = createPlateDocument();
  const part = {
    ...document.parts[0]!,
    drawnOn: { on: { plane: 'top' as const }, offset: 0 },
    ...(mode === 'thin' ? { thin: { depth: 100 } } : { remove: { depth: 6 } }),
  };
  document.parts[0] = part;
  let latest = document;
  const change = vi.fn((update: (document: CadDocument) => CadDocument) => {
    latest = update(latest);
  });
  render(<ExtrudeDialog document={document} part={part} onChange={change} onOk={() => {}} onCancel={() => {}} onEditSketch={() => {}} />);
  edit(mode === 'thin' ? 'Depth' : 'Cut depth', '32');
  expect(change).toHaveBeenCalled();
  expect(mode === 'thin' ? latest.parts[0]!.thin?.depth : latest.parts[0]!.remove?.depth).toBe(32);
});

it('previews hole diameter and blind depth without leaving either field', () => {
  const document = createPlateDocument();
  const part = { ...document.parts[0]!, hole: { diameter: 5 }, remove: { depth: 10 } };
  document.parts[0] = part;
  let latest = document;
  const change = vi.fn((update: (document: CadDocument) => CadDocument) => {
    latest = update(latest);
  });
  render(<HoleDialog document={document} part={part} onChange={change} onOk={() => {}} onCancel={() => {}} />);
  edit('Diameter', '9');
  expect(latest.parts[0]!.hole?.diameter).toBe(9);
  edit('Depth', '12');
  expect(latest.parts[0]!.hole?.diameter).toBe(9);
  expect(latest.parts[0]!.remove?.depth).toBe(12);
  edit('Depth', '0');
  expect(latest.parts[0]!.remove?.depth).toBe(12);
});
