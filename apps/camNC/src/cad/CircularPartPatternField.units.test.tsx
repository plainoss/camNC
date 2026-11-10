import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CadPartPattern } from '@wbcnc/cad';
import { CircularPartPatternField } from './CircularPartPatternField';
import { DesignUnitContext } from './designUnits';
import type { CadConnectorPick } from './PartFeatureDialogs';

afterEach(cleanup);
const pattern: CadPartPattern & { circular: NonNullable<CadPartPattern['circular']> } = {
  id: 'legs',
  axis: 'x',
  count: 4,
  spacing: 100,
  circular: { origin: [31.3580244091242, -12.3456789012345, 0], axis: [0, 0, 1], angle: 137.123456789012, equalSpacing: true },
};

it('edits circular axis origins in inches without rounding untouched coordinates or angles', () => {
  const change = vi.fn();
  render(
    <DesignUnitContext value="in">
      <CircularPartPatternField pattern={pattern} onChange={change} />
    </DesignUnitContext>
  );
  fireEvent.click(screen.getByText('Axis origin', { selector: 'summary' }));
  expect(screen.getByLabelText('Axis origin X')).toHaveValue(String(pattern.circular.origin[0] / 25.4));
  fireEvent.change(screen.getByLabelText('Axis origin Y'), { target: { value: '2.125' } });
  fireEvent.blur(screen.getByLabelText('Axis origin Y'));
  const next = change.mock.lastCall![0] as CadPartPattern;
  expect(next.circular!.origin[0]).toBeCloseTo(pattern.circular.origin[0], 12);
  expect(next.circular!.origin[1]).toBeCloseTo(53.975, 12);
  expect(next.circular!.angle).toBe(pattern.circular.angle);
});

it('retains a precise picked origin when a later count edit reparses inch coordinates', () => {
  const change = vi.fn();
  let picked: ((pick: CadConnectorPick) => void) | null = null;
  render(
    <DesignUnitContext value="in">
      <CircularPartPatternField
        pattern={pattern}
        onChange={change}
        pickPoint={callback => {
          picked = callback;
        }}
      />
    </DesignUnitContext>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Axis of pattern' }));
  const origin: [number, number, number] = [31.4159265358979, -17.1234567890123, 6.9876543210123];
  act(() => picked!({ partId: 'leg', point: origin, normal: [0, 0, 1] }));
  fireEvent.change(screen.getByLabelText('Instance count'), { target: { value: '5' } });
  fireEvent.blur(screen.getByLabelText('Instance count'));
  const next = change.mock.lastCall![0] as CadPartPattern;
  expect(next.count).toBe(5);
  origin.forEach((value, index) => expect(next.circular!.origin[index]).toBeCloseTo(value, 12));
  expect(next.circular!.angle).toBe(pattern.circular.angle);
});
