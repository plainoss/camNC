import { design } from '@wbcnc/cad-script';

// Four internally tangent circles give exact outer bounds and a constant-width inset.
// Keep derived coordinates as expressions so changing the folder's dimensions reshapes both profiles.
export default design(d => {
  d.folder('Pebble tray', s => {
    s.variable('width', '280mm');
    s.variable('height', '190mm');
    s.variable('blank', '40mm');
    s.variable('pocketDepth', '30mm');
    s.variable('wall', '18mm');
    if (s.value('width') <= s.value('height') || s.value('wall') >= s.value('height*0.32'))
      throw new Error('Use width > height and wall < 0.32*height.');
    s.variable('span', 'width/height - 0.74');
    s.variable('shift', '2*(0.16*span*span - 0.00288)/(0.32*span + sqrt(0.2304*span*span - 0.002304))');
    s.variable('cx', 'height*(0.42 + shift)');
    s.variable('radius', 'height*(shift*shift + 0.0736)/0.16');
    const part = s.newPart('Pebble tray', { thickness: 'blank' });
    const profile = (sketch = part.profile, inset = false) => {
      const r = inset ? '(radius-wall)' : 'radius';
      const left = inset ? '(height*0.42-wall)' : 'height*0.42';
      const right = inset ? '(height*0.32-wall)' : 'height*0.32';
      const x1 = `cx+${r}*(height*0.42-cx)/(radius-height*0.42)`;
      const y1 = `height-radius+${r}*(radius-height/2)/(radius-height*0.42)`;
      const x2 = `cx+${r}*(width-height*0.32-cx)/(radius-height*0.32)`;
      const y2 = `height-radius+${r}*(radius-height/2)/(radius-height*0.32)`;
      sketch
        .path([x1, y1])
        .arcTo([x1, `height-(${y1})`], { r: left })
        .arcTo([x2, `height-(${y2})`], { r })
        .arcTo([x2, y2], { r: right })
        .arcTo([x1, y1], { r })
        .close();
    };
    profile(part.profile, false);
    const top = part.sketchOn('top');
    profile(top, true);
    part.cut(top.regionAt(s.value('width/2'), s.value('height/2')), { depth: 'pocketDepth' });
    part.expect({
      size: [s.value('width'), s.value('height')],
      thickness: s.value('blank'),
      holes: 0,
      pockets: 1,
      depths: [s.value('pocketDepth')],
    });
  });
});
