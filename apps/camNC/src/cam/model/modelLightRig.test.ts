import { Color, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { kModelLights, type LightVector, type ModelLightRig } from './modelLightRig';

/** Linear luminance of a colour as three.js uses it for lighting. */
const luminance = (hex: string) => {
  const c = new Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

/** Diffuse light a face with this normal receives, by Lambert's law, as three.js shades a standard material. */
function lit(rig: ModelLightRig, normal: LightVector) {
  const n = new Vector3(...normal).normalize();
  let light = 0;
  for (const { position, intensity } of rig.directional) light += intensity * Math.max(0, n.dot(new Vector3(...position).normalize()));
  const sky = 0.5 * n.dot(new Vector3(...rig.hemisphere.up).normalize()) + 0.5;
  const { intensity } = rig.hemisphere;
  return light + intensity * (luminance(rig.hemisphere.sky) * sky + luminance(rig.hemisphere.ground) * (1 - sky));
}

/** Every view the view cube offers: its faces, edges and corners. */
const kCubeViews: LightVector[] = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) kCubeViews.push([x, y, z]);

/** What makes a rig fall short: dim views, opposite faces far apart, flat shading or an ambient wash. */
function problems(rig: ModelLightRig) {
  const found: string[] = [];
  const top = lit(rig, [0, 0, 1]);
  for (const view of kCubeViews) if (lit(rig, view) < 0.5 * top) found.push(`view ${view} under half the top`);
  if (lit(rig, [0, 0, -1]) < 0.8 * top) found.push('bottom under 80% of the top');
  if (lit(rig, [0, 1, 0]) < 0.9 * lit(rig, [0, -1, 0])) found.push('back under 90% of the front');
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1]) {
        const faces = [lit(rig, [x, 0, 0]), lit(rig, [0, y, 0]), lit(rig, [0, 0, z])].sort((a, b) => a - b);
        const step = Math.min(faces[1]! - faces[0]!, faces[2]! - faces[1]!) / faces[2]!;
        if (step < 0.1) found.push(`faces around corner ${[x, y, z]} within 10%`);
      }
  if (rig.hemisphere.intensity * luminance(rig.hemisphere.sky) > 0.45 * top) found.push('sky over 45% of the top');
  return found;
}

describe('model light rig', () => {
  it('lights every view-cube view well, with opposite faces alike and the faces at a corner in different shades', () => {
    expect(problems(kModelLights)).toEqual([]);
  });

  it('does not pass with the lights that left undersides dark', () => {
    const before: ModelLightRig = {
      hemisphere: { sky: '#ffffff', ground: '#8a8178', intensity: 1.4, up: [0, 0, 1] },
      directional: [
        { position: [300, -500, 800], intensity: 1.8 },
        { position: [-400, 300, 200], intensity: 0.4 },
      ],
    };
    expect(problems(before)).toEqual(
      expect.arrayContaining(['view 0,0,-1 under half the top', 'bottom under 80% of the top', 'back under 90% of the front'])
    );
  });

  it('does not pass with a flat light from everywhere', () => {
    const flat: ModelLightRig = { hemisphere: { sky: '#ffffff', ground: '#ffffff', intensity: 3, up: [0, 0, 1] }, directional: [] };
    expect(problems(flat)).toContain('faces around corner 1,1,1 within 10%');
    expect(problems(flat)).toContain('sky over 45% of the top');
  });
});
