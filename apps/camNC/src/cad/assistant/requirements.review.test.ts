import { createCadDocument } from '@wbcnc/cad';
import { compactCadReport, editCad } from '@wbcnc/cad-script';
import { expect, it } from 'vitest';
import { checkAssistantRequirements } from './requirements';

it('resolves report handles by persistent identity when folders reuse source names', async () => {
  const base = createCadDocument();
  const checked = await editCad(
    base,
    d => {
      d.folder('Small', s => s.newPart('Panel', { thickness: 18 }).profile.rect({ at: [0, 0], w: 100, h: 80 }));
      d.folder('Large', s => s.newPart('Panel', { thickness: 24 }).profile.rect({ at: [0, 0], w: 200, h: 80 }));
    },
    { toolpaths: false }
  );
  expect(checked.ok).toBe(true);
  const compact = compactCadReport(checked.document, checked.report);
  const handle = compact.parts.find(part => part.thickness === 24)!.ref;
  expect(
    checkAssistantRequirements({ part: handle, width: 200, thickness: 24 }, base, checked.document, checked.report, checked.parts).ok
  ).toBe(true);
  expect(
    checkAssistantRequirements({ part: handle, width: 100, thickness: 18 }, base, checked.document, checked.report, checked.parts).ok
  ).toBe(false);
});

it('refuses globally ambiguous copy names and accepts exact copy IDs', async () => {
  const base = createCadDocument();
  const checked = await editCad(
    base,
    d => {
      d.folder('Small', s => {
        const panel = s.newPart('Panel', { thickness: 18 });
        panel.profile.rect({ at: [0, 0], w: 100, h: 80 });
        panel.copy({ at: [0, 0, 40], name: 'Upper' });
      });
      d.folder('Large', s => {
        const panel = s.newPart('Panel', { thickness: 24 });
        panel.profile.rect({ at: [0, 0], w: 200, h: 80 });
        panel.copy({ at: [400, 0, 40], name: 'Upper' });
      });
    },
    { toolpaths: false }
  );
  expect(checked.ok).toBe(true);
  expect(checkAssistantRequirements({ part: 'Upper', width: 100 }, base, checked.document, checked.report, checked.parts).ok).toBe(false);
  const id = checked.document.parts.find(part => part.thickness === 24)!.copies![0]!.id;
  expect(
    checkAssistantRequirements({ part: id, width: 200, thickness: 24 }, base, checked.document, checked.report, checked.parts).ok
  ).toBe(true);
});

it('does not claim a solid minimum pocket floor through a drilled hole', async () => {
  const base = createCadDocument();
  const checked = await editCad(
    base,
    d => {
      const tray = d.newPart('Tray', { thickness: 40 });
      tray.profile.rect({ at: [0, 0], w: 280, h: 190 });
      const pocket = tray.sketchOn('top');
      pocket.rect({ at: [18, 18], w: 244, h: 154 });
      tray.cut(pocket.regionAt(100, 100), { depth: 30 });
      const drain = tray.sketchOn('top');
      drain.circle({ at: [100, 100], d: 10 });
      tray.cut(drain.regionAt(100, 100), { depth: 'through' });
    },
    { toolpaths: false }
  );
  expect(checked.ok).toBe(true);
  expect(checkAssistantRequirements({ part: 'Tray', minimumFloor: 10 }, base, checked.document, checked.report, checked.parts).ok).toBe(
    false
  );
});
