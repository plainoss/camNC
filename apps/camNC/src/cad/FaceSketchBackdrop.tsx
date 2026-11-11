import { Canvas } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { Matrix4 } from 'three';
import { SketchCamera, type SketchView } from '@/cam/model/ModelViewport';
import { ModelLights } from '@/cam/model/ModelLights';
import type { FaceSketchScene } from './faceSketchScene';
import { partSolid } from './partSolid';
import { settledCanvas } from '@/lib/settledCanvas';

const identity = new Matrix4();

/** Keep the same machined solid behind a face sketch, in the per-part view's coordinate frame. */
export default function FaceSketchBackdrop({ scene, view }: { scene: FaceSketchScene; view: SketchView }) {
  const solid = useMemo(
    () => partSolid(scene.document.parts.find(part => part.id === scene.partId)!, scene.document, scene.copyId),
    [scene]
  );
  useEffect(() => () => solid.geometry?.dispose(), [solid]);
  return (
    <div className="cad-sketch-backdrop" aria-hidden="true">
      <Canvas orthographic frameloop="demand" dpr={[1, 2]} {...settledCanvas}>
        <SketchCamera view={view} model={identity} />
        <ModelLights />
        {solid.geometry && (
          <mesh geometry={solid.geometry} position={[solid.origin![0], solid.origin![1], 0]}>
            <meshStandardMaterial vertexColors color="#c9a477" roughness={0.8} />
            <Edges geometry={solid.geometry} threshold={30} color="#5b4a36" />
          </mesh>
        )}
      </Canvas>
    </div>
  );
}
