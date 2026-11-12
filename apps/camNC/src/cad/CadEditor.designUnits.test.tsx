import { createPlateDocument, type CadDocument, type CadLengthUnit } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { solveCadDocument } from './solveCad';
import { endCadSession } from '@wbcnc/cad-editor/session';
import { settled } from '@/test/settled';

// The editor's lazy views and the solver's worker and WASM load once per file, outside the first test's time limit.
beforeAll(async () => {
  await Promise.all([import('./WorkspaceView'), import('./SketchBackdrop'), import('./PartView3D'), import('./FaceSketchBackdrop')]);
  await solveCadDocument(createPlateDocument({ width: 200, height: 100 }));
}, 60_000);

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

async function studio(lengthUnit: CadLengthUnit, variables?: CadDocument['variables']) {
  const source: CadDocument = { ...createPlateDocument({ width: 200, height: 100 }), lengthUnit, ...(variables && { variables }) };
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700, display: 'flex' }}>
      <CadEditor document={source} startIn3D onDraftChange={change} onFinish={async () => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  return () => change.mock.calls.at(-1)?.[0] ?? source;
}

const extrudeStep = async () =>
  within(await screen.findByRole('region', { name: 'Features' })).getByRole('button', { name: /Extrude · Plate/ });

async function thicknessField() {
  await userEvent.dblClick(await extrudeStep());
  const dialog = await screen.findByRole('dialog', { name: 'Extrude · Plate' });
  return { dialog, thickness: within(dialog).getByRole('textbox', { name: /Thickness/ }) as HTMLInputElement };
}

it.each([
  ['in', '0.709 in', '0.70866'],
  ['cm', '1.8 cm', '1.8'],
] as const)('reads an %s design’s thickness in its unit in the feature list and the Extrude dialog', async (unit, listed, field) => {
  await studio(unit);
  expect((await extrudeStep()).textContent).toContain(listed);
  expect((await extrudeStep()).textContent).not.toContain('mm');
  const { thickness } = await thicknessField();
  expect(thickness.value).toBe(field);
});

it('adds an eighth of an inch for "t + 0.125" in an inch design', async () => {
  const latest = await studio('in', [{ id: 't', name: 't', expression: '0.75 in' }]);
  const { dialog, thickness } = await thicknessField();
  await userEvent.clear(thickness);
  await userEvent.type(thickness, 't + 0.125');
  await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(latest().parts[0]!.thicknessExpression).toBe('t + 0.125 in'));
  expect(latest().parts[0]!.thickness).toBeCloseTo(22.225, 9);
  await waitFor(async () => expect((await extrudeStep()).textContent).toContain('t + 0.125 in = 0.875 in'));
});

it('makes "#board = 2" typed in a cm design a 2 cm variable', async () => {
  const latest = await studio('cm');
  const { thickness } = await thicknessField();
  await userEvent.clear(thickness);
  await userEvent.type(thickness, '#board = 2{Enter}');
  await waitFor(() => expect(latest().variables?.map(variable => [variable.name, variable.expression])).toEqual([['board', '2 cm']]));
  await waitFor(() => expect(latest().parts[0]!.thickness).toBe(20));
});
