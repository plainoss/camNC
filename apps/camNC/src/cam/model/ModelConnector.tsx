import { Html, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Group, Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';

export interface ViewConnector {
  point: [number, number, number];
  normal: [number, number, number];
  label: string;
}

/** A connector frame aligned with its face, kept legible at any camera zoom. */
export function ModelConnector({ connector, model }: { connector: ViewConnector; model: Matrix4 }) {
  const frame = useMemo(() => {
    const z = new Vector3(...connector.normal).normalize();
    const x = new Vector3(Math.abs(z.x) < 0.9 ? 1 : 0, Math.abs(z.x) < 0.9 ? 0 : 1, 0);
    x.addScaledVector(z, -x.dot(z)).normalize();
    const y = new Vector3().crossVectors(z, x);
    return model.clone().multiply(new Matrix4().makeBasis(x, y, z).setPosition(...connector.point));
  }, [connector, model]);
  const axes = useRef<Group>(null);
  useFrame(({ camera, size }) => {
    if (!axes.current || !size.height) return;
    const height =
      camera instanceof OrthographicCamera
        ? (camera.top - camera.bottom) / camera.zoom
        : camera instanceof PerspectiveCamera
          ? (2 * camera.position.distanceTo(new Vector3().setFromMatrixPosition(frame)) * Math.tan((camera.fov * Math.PI) / 360)) /
            camera.zoom
          : 1;
    axes.current.scale.setScalar((28 * height) / size.height);
  });
  return (
    <group name={connector.label} matrixAutoUpdate={false} matrix={frame}>
      <group ref={axes}>
        {(
          [
            ['#d95151', [1, 0, 0]],
            ['#42aa6b', [0, 1, 0]],
            ['#397feb', [0, 0, 1]],
          ] as const
        ).map(([color, end]) => (
          <Line
            key={color}
            points={[[0, 0, 0], [...end]]}
            color={color}
            lineWidth={3}
            depthTest={false}
            raycast={() => {}}
            renderOrder={10}
          />
        ))}
      </group>
      <Html center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <span
          data-testid="mate-connector-preview"
          aria-label={connector.label}
          title={connector.label}
          style={{ display: 'block', width: 9, height: 9, borderRadius: '50%', border: '2px solid #194a85', background: '#fff' }}
        />
      </Html>
    </group>
  );
}
