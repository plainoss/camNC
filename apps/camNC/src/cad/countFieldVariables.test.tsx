import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { cadVariableScope, createCadPart, createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { useRef, useState, type ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { CadPartPatternField } from './CadPartPatternField';
import { CircularPartPatternField } from './CircularPartPatternField';
import { DesignUnitContext } from './designUnits';
import { PartCutDialog } from './PartCutDialog';
import { useEditorVariableFields } from './useEditorVariableFields';

afterEach(cleanup);

/** The editor's variables, made from fields as in the editor, in a cm design. */
function withVariables(children: (document: CadDocument) => ReactNode) {
  const state = { document: { ...createPlateDocument({ width: 300, height: 600 }), lengthUnit: 'cm' } as CadDocument };
  state.document.parts.push({ ...createCadPart('Back', 6), id: 'back' });
  function Host() {
    const [document, setDocument] = useState(state.document);
    const current = useRef(document);
    current.current = document;
    useEditorVariableFields(document, current, next => {
      current.current = state.document = next;
      setDocument(next);
    });
    return <DesignUnitContext value="cm">{children(document)}</DesignUnitContext>;
  }
  render(<Host />);
  return state;
}

async function defineIn(field: HTMLElement, state: { document: CadDocument }) {
  await userEvent.clear(field);
  await userEvent.type(field, '#n = 5{Enter}');
  await waitFor(() => expect(state.document.variables?.map(variable => [variable.name, variable.expression])).toEqual([['n', '5']]));
  expect(cadVariableScope(state.document).n).toEqual({ value: 5, kind: 'number' });
  expect(field.getAttribute('aria-invalid')).toBeNull();
}

it('makes "#n = 5" in a part pattern’s count a number variable', async () => {
  const state = withVariables(document => (
    <CadPartPatternField
      pattern={{ id: 'p', axis: 'x', count: 2, spacing: 100 }}
      variables={cadVariableScope(document)}
      onChange={() => {}}
    />
  ));
  await defineIn(screen.getByLabelText('How many'), state);
});

it('makes "#n = 5" in a circular pattern’s count a number variable', async () => {
  const state = withVariables(document => (
    <CircularPartPatternField
      variables={cadVariableScope(document)}
      pattern={{
        id: 'p',
        axis: 'x',
        count: 4,
        spacing: 100,
        circular: { origin: [0, 0, 0], axis: [0, 0, 1], angle: 360, equalSpacing: true },
      }}
      onChange={() => {}}
    />
  ));
  await defineIn(screen.getByLabelText('Instance count'), state);
});

it('makes "#n = 5" in a finger joint’s Fingers a number variable', async () => {
  const state = withVariables(document => (
    <PartCutDialog document={document} variables={cadVariableScope(document)} tool="back" onSave={() => {}} onClose={() => {}} />
  ));
  fireEvent.change(screen.getByLabelText('Joint'), { target: { value: 'fingers' } });
  await defineIn(screen.getByLabelText('Fingers'), state);
});

it('makes "#w = 30" in a length field a length in the design’s unit, and keeps a number variable a number', async () => {
  const state = withVariables(document => (
    <CadPartPatternField
      pattern={{ id: 'p', axis: 'x', count: 2, spacing: 100 }}
      variables={cadVariableScope(document)}
      onChange={() => {}}
    />
  ));
  const spacing = screen.getByLabelText(/Spacing/);
  await userEvent.clear(spacing);
  await userEvent.type(spacing, '#w = 30{Enter}');
  await waitFor(() => expect(state.document.variables?.map(variable => variable.expression)).toEqual(['30 cm']));
  expect(cadVariableScope(state.document).w).toEqual({ value: 300, kind: 'length' });
  // A number variable made in a count, then redefined in a length field, stays a number.
  const count = screen.getByLabelText('How many');
  await userEvent.clear(count);
  await userEvent.type(count, '#n = 3{Enter}');
  await waitFor(() => expect(cadVariableScope(state.document).n).toEqual({ value: 3, kind: 'number' }));
  await userEvent.clear(spacing);
  await userEvent.type(spacing, '#n = 4{Enter}');
  await waitFor(() => expect(state.document.variables?.find(variable => variable.name === 'n')?.expression).toBe('4'));
  expect(cadVariableScope(state.document).n).toEqual({ value: 4, kind: 'number' });
});
