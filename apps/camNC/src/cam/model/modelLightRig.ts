export type LightVector = [number, number, number];

/** The lights of every model 3D view, in the model's Z-up frame. */
export interface ModelLightRig {
  /** Sky colour from `up`, ground colour from the opposite side, blended by how far a face turns toward each. */
  hemisphere: { sky: string; ground: string; intensity: number; up: LightVector };
  /** Each shines from its position toward the origin. */
  directional: { position: LightVector; intensity: number }[];
}

/**
 * Two opposed pairs of lights, so a face and the face opposite it read about equally bright: undersides and the back
 * look much like the top and front. The main pair shines from above front right and from below back left; the weaker
 * pair lights the faces that turn sideways to it. Each light leans a different amount toward each axis, so the three
 * faces seen around any corner keep different shades. The lower light of each pair is a little stronger only to make
 * up for the sky, which keeps tops slightly the brightest.
 */
export const kModelLights: ModelLightRig = {
  hemisphere: { sky: '#ffffff', ground: '#d8d0c6', intensity: 1.05, up: [0, 0, 1] },
  directional: [
    { position: [250, -300, 900], intensity: 1.5 },
    { position: [-250, 300, -900], intensity: 1.6 },
    { position: [400, 800, 400], intensity: 0.7 },
    { position: [-400, -800, -400], intensity: 0.9 },
  ],
};
