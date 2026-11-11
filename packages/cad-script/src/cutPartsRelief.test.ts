import { expect, it } from 'vitest';
import { editCad, type DesignEdit } from './index';

const mortise = (cornerRelief?: Parameters<DesignEdit['cutParts']>[1]['cornerRelief']) => (d: DesignEdit) => {
  d.variable('cutter', '6mm');
  const seat = d.newPart('Seat', { thickness: 18 });
  seat.profile.rect({ at: [0, 0], w: 200, h: 200 });
  seat.drawOn('top');
  const tenon = d.newPart('Tenon', { thickness: 18 });
  tenon.profile.rect({ at: [80, 91], w: 40, h: 18 });
  tenon.drawOn('top', { offset: '9mm' });
  d.cutParts(seat, { with: tenon, clearance: '0.2mm', ...(cornerRelief !== undefined && { cornerRelief }) });
};

it('relieves one step’s mortise corners for the named cutter, keeping its variable in the saved step', async () => {
  const { document, report } = await editCad(null, mortise({ dogbone: 'cutter' }));
  expect(report.errors).toEqual([]);
  expect(document.partCuts![0]!.cornerRelief).toEqual({ diameter: 6, diameterExpression: 'cutter' });
  expect(document.version).toBe(5);
  // The seat itself stays square; only this step's opening has bones.
  expect(document.parts.find(part => part.name === 'Seat')!.cornerRelief).toBeUndefined();
});

it('saves an explicit Off, and leaves the step inheriting when not given', async () => {
  expect((await editCad(null, mortise('off'))).document.partCuts![0]!.cornerRelief).toBeNull();
  expect((await editCad(null, mortise())).document.partCuts![0]).not.toHaveProperty('cornerRelief');
});

it('refuses a dogbone without a usable cutter diameter', async () => {
  expect((await editCad(null, mortise({ dogbone: 0 }))).scriptError).toBe('A dogbone needs a cutter diameter greater than zero, not 0 mm.');
});
