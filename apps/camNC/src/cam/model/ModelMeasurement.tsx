import { Html, Line } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';
import type { MeasureEntity, MeasureVec3 } from '@/cad/measureGeometry';

export interface ModelMeasureWitness {
  a: MeasureVec3;
  b: MeasureVec3;
  axis?: 'x' | 'y' | 'z';
}

const colors = { x: '#c93838', y: '#237a39', z: '#216bc4' };
const selected = '#e08a16';
// Measurement graphics must never intercept the next geometry pick, even where their witness crosses another part.
const noRaycast = () => undefined;

function Marker({ point, color }: { point: MeasureVec3; color: string }) {
  return (
    <Html position={point} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
      <span
        aria-hidden="true"
        style={{ display: 'block', width: 7, height: 7, borderRadius: '50%', border: '1px solid #fff', background: color }}
      />
    </Html>
  );
}

function Face({ entity }: { entity: Extract<MeasureEntity, { kind: 'face' }> }) {
  const geometry = useMemo(() => {
    const result = new BufferGeometry();
    result.setAttribute('position', new BufferAttribute(new Float32Array(entity.triangles.flat(2)), 3));
    return result;
  }, [entity]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} raycast={noRaycast} renderOrder={3}>
      <meshBasicMaterial color={selected} transparent opacity={0.24} side={DoubleSide} depthTest={false} depthWrite={false} />
    </mesh>
  );
}

/** Selected geometry and the active measurement's dotted witness, all fixed to assembly coordinates. */
export function ModelMeasurement({ selection, witness }: { selection: readonly MeasureEntity[]; witness?: ModelMeasureWitness }) {
  const color = witness?.axis ? colors[witness.axis] : '#3464a5';
  const distinct = witness?.a.some((value, i) => value !== witness.b[i]);
  return (
    <group>
      {selection.map((entity, i) =>
        entity.kind === 'vertex' ? (
          <Marker key={i} point={entity.point} color={selected} />
        ) : entity.kind === 'edge' ? (
          <Line
            key={i}
            points={[entity.a, entity.b]}
            color={selected}
            lineWidth={3}
            depthTest={false}
            depthWrite={false}
            raycast={noRaycast}
            renderOrder={3}
          />
        ) : (
          <Face key={i} entity={entity} />
        )
      )}
      {witness && (
        <>
          {/* A zero-distance measurement has a marker; a zero-length thick line has no defined screen direction. */}
          {distinct && (
            <Line
              points={[witness.a, witness.b]}
              color={color}
              lineWidth={1.5}
              dashed
              dashSize={5}
              gapSize={3}
              depthTest={false}
              depthWrite={false}
              raycast={noRaycast}
              renderOrder={4}
            />
          )}
          <Marker point={witness.a} color={color} />
          {distinct && <Marker point={witness.b} color={color} />}
          <Html
            position={witness.a.map((value, i) => (value + witness.b[i]!) / 2) as MeasureVec3}
            zIndexRange={[4, 0]}
            style={{ pointerEvents: 'none' }}>
            <span aria-hidden="true" data-testid="measurement-witness" data-start={witness.a.join(',')} data-end={witness.b.join(',')} />
          </Html>
        </>
      )}
    </group>
  );
}
