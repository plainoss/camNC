import { kModelLights } from './modelLightRig';

/** The shared light rig of the Part Studio, part and face-sketch 3D views. */
export function ModelLights() {
  const { hemisphere, directional } = kModelLights;
  return (
    <>
      <hemisphereLight args={[hemisphere.sky, hemisphere.ground, hemisphere.intensity]} position={hemisphere.up} />
      {directional.map((light, i) => (
        <directionalLight key={i} position={light.position} intensity={light.intensity} />
      ))}
    </>
  );
}
