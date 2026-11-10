import { design } from '@wbcnc/cad-script';

/** A rounded tray with a deeper recess sketched on the first pocket's floor. */
export default design(d => {
  const tray = d.newPart('Tray', { thickness: 24 });
  const outline = tray.profile.rect({ at: [0, 0], w: 260, h: 160 });
  tray.profile.fillet(outline.corners, 12);
  const top = tray.sketchOn('top');
  top.rect({ at: [15, 15], w: 230, h: 130 });
  const bowl = tray.cut(top.regionAt(130, 80), { depth: 8 });
  const floor = tray.sketchOn({ floorOf: bowl });
  floor.circle({ at: [130, 80], d: 60 });
  tray.cut(floor.regionAt(130, 80), { depth: 6 });
  tray.expect({ size: [260, 160], holes: 0, pockets: 2, depths: [8, 14], freedom: 0 });
});
