import { GizmoHelper, GizmoViewcube } from '@react-three/drei';
import { useLayoutEffect, useRef } from 'react';
import type { Group } from 'three';
import type { ViewRequest } from './ModelViewport';
import { turnViewCubeBottomLabel } from './viewCubeBottomLabel';

/** Convert the Y-up cube's local face normal or edge/corner position to the model's Z-up frame. */
// eslint-disable-next-line react-refresh/only-export-components
export function cubeViewRequest([x, y, z]: [number, number, number]): Omit<ViewRequest, 'seq'> {
  const direction: [number, number, number] = [Math.sign(x), -Math.sign(z) || 0, Math.sign(y)];
  if (direction.filter(Boolean).length === 1) {
    if (direction[0]) return { name: direction[0] > 0 ? 'right' : 'left' };
    if (direction[1]) return { name: direction[1] > 0 ? 'back' : 'front' };
    return { name: direction[2] > 0 ? 'top' : 'bottom' };
  }
  return { name: 'iso', direction };
}

export function ViewCube({ onViewRequest }: { onViewRequest: (request: Omit<ViewRequest, 'seq'>) => void }) {
  const cube = useRef<Group>(null);
  useLayoutEffect(() => {
    if (cube.current) turnViewCubeBottomLabel(cube.current);
  }, []);
  return (
    <GizmoHelper alignment="top-right" margin={[64, 112]}>
      <group ref={cube} rotation={[Math.PI / 2, 0, 0]} scale={1.3}>
        <GizmoViewcube
          faces={['Right', 'Left', 'Top', 'Bottom', 'Front', 'Back']}
          onClick={event => {
            event.stopPropagation();
            const direction = event.object.position.lengthSq() ? event.object.position : event.face?.normal;
            if (direction && event.delta <= 4) onViewRequest(cubeViewRequest(direction.toArray()));
            return null;
          }}
        />
      </group>
    </GizmoHelper>
  );
}
