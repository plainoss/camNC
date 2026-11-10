import { createCadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import source from '../../../../../packages/cad-script/examples/pebble-tray.cad.ts?raw';
import { checkScriptInBrowser } from './scriptCheck';

it('builds an exact-size pebble tray and keeps its shape editable through folder variables', async () => {
  const checked = await checkScriptInBrowser(createCadDocument(), source);
  expect(checked.scriptError).toBeUndefined();
  expect(checked.ok).toBe(true);
  const part = checked.report.parts.find(part => part.outline)!;
  expect(part.outline?.size[0]).toBeCloseTo(280, 1);
  expect(part.outline?.size[1]).toBeCloseTo(190, 1);
  expect(part.cuts).toHaveLength(1);
  expect(part.cuts[0]).toMatchObject({ through: false, from: 0, to: 30 });
  const changed = await checkScriptInBrowser(
    checked.document,
    `d => {
    d.existingFolder('Pebble tray', s => { s.variable('width', '240mm'); s.variable('height', '160mm'); s.variable('blank', '30mm'); s.variable('pocketDepth', '20mm'); s.variable('wall', '12mm'); });
  }`
  );
  expect(changed.scriptError).toBeUndefined();
  expect(changed.ok).toBe(true);
  expect(changed.document.parts[0]?.id).toBe(checked.document.parts[0]?.id);
  const resized = changed.report.parts.find(part => part.outline)!;
  expect(resized.outline?.size[0]).toBeCloseTo(240, 1);
  expect(resized.outline?.size[1]).toBeCloseTo(160, 1);
  expect(resized.thickness).toBe(30);
  expect(resized.cuts[0]?.to).toBe(20);
  // Two isolated checks each retain their own 30-second deadline; shared CI also runs full toolpath planning.
}, 90_000);
