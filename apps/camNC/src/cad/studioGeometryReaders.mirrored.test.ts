import { addPartCopy, addRectangle, createCadPart, createPlateDocument, resolveDrawnPlacements } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { physicalCopyMirrored } from './studioGeometryReaders';

it('reflects an Add body on a mirrored host copy in a legacy document', () => {
  const initial = createPlateDocument({ width: 100, height: 60, thickness: 18 });
  const host = initial.parts[0]!;
  host.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const copied = addPartCopy(initial, host.id, { mirrored: true, offset: { position: [200, 0, 0], rotation: [0, 0, 0, 1] } });
  const boss = createCadPart('Boss', 6);
  boss.sketch = addRectangle(boss.sketch, { x: 15, y: 10, width: 20, height: 12, dimensioned: true, positioned: true });
  boss.addTo = host.id;
  boss.drawnOn = { on: { partId: host.id, face: 'top' }, offset: 0 };
  const document = resolveDrawnPlacements({ ...copied.document, parts: [...copied.document.parts, boss] }).document;
  expect(document.operationOrder).toBeUndefined();
  expect(physicalCopyMirrored(document, host.id, copied.id)).toBe(true);
  expect(physicalCopyMirrored(document, boss.id, copied.id)).toBe(true);
  expect(physicalCopyMirrored(document, boss.id)).toBe(false);
});
