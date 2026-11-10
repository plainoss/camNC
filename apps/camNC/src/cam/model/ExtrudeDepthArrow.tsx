import { Html, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Raycaster, Vector2, Vector3 } from 'three';
import { CAD_THICKNESS_RANGE } from '@wbcnc/cad';
import { clampExtrudeDepth, distanceAlongAxis, type ExtrudeDepthControl } from '@/cad/extrudeDepth';
import './extrudeDepthArrow.css';

interface Drag {
  pointerId: number;
  start: number | null;
  x: number;
  y: number;
  depth: number;
  value: number;
  pixels: Vector2;
  millimetresPerPixel: number;
}

/** A constant-size grip on the extrusion end, measured along the model axis rather than screen X or Y. */
export function ExtrudeDepthArrow({ control }: { control: ExtrudeDepthControl }) {
  const { camera, gl, size } = useThree();
  const [angle, setAngle] = useState(0);
  const drag = useRef<Drag | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (control.dragging) button.current?.focus({ preventScroll: true });
    if (control.dragging || !drag.current) return;
    const pointerId = drag.current.pointerId;
    drag.current = null;
    if (button.current?.hasPointerCapture(pointerId)) button.current.releasePointerCapture(pointerId);
  }, [control.dragging]);
  const origin = new Vector3(...control.origin),
    axis = new Vector3(...control.direction).normalize();
  const end = origin.clone().addScaledVector(axis, control.depth / control.factor + 8);
  const ray = (x: number, y: number) => {
    const box = gl.domElement.getBoundingClientRect();
    const cast = new Raycaster();
    cast.setFromCamera(new Vector2(((x - box.left) / box.width) * 2 - 1, 1 - ((y - box.top) / box.height) * 2), camera);
    return distanceAlongAxis(cast.ray.origin.toArray(), cast.ray.direction.toArray(), control.origin, control.direction);
  };
  const projectedAxis = () => {
    camera.updateMatrixWorld();
    const a = origin.clone().project(camera),
      b = origin.clone().add(axis).project(camera);
    return new Vector2(((b.x - a.x) * size.width) / 2, (-(b.y - a.y) * size.height) / 2);
  };
  useFrame(() => {
    const projected = projectedAxis();
    const next = projected.length() > 0.01 ? Math.atan2(projected.y, projected.x) + Math.PI / 2 : 0;
    setAngle(previous => (Math.abs(previous - next) > 1e-4 ? next : previous));
  });
  const valueAt = (event: PointerEvent<HTMLButtonElement>) => {
    const moving = drag.current;
    if (!moving) return control.depth;
    // Merely clicking the grip preserves arbitrary precision and expression-backed depths.
    if (Math.hypot(event.clientX - moving.x, event.clientY - moving.y) < 2) return moving.depth;
    const at = ray(event.clientX, event.clientY);
    const delta =
      moving.start !== null && at !== null
        ? at - moving.start
        : new Vector2(event.clientX - moving.x, event.clientY - moving.y).dot(moving.pixels) * moving.millimetresPerPixel;
    return clampExtrudeDepth(moving.depth + delta * control.factor);
  };
  const cancel = () => {
    if (!drag.current) return;
    const pointerId = drag.current.pointerId;
    drag.current = null;
    control.onCancel();
    if (button.current?.hasPointerCapture(pointerId)) button.current.releasePointerCapture(pointerId);
  };
  return (
    <>
      <Line
        points={[control.origin, end.toArray()]}
        color={control.dragging ? '#2f80ed' : '#f0b62a'}
        lineWidth={2}
        depthTest={false}
        raycast={() => {}}
      />
      <Html center position={end.toArray()} zIndexRange={[5, 0]}>
        <button
          ref={button}
          type="button"
          role="slider"
          className="cad-extrude-depth-arrow"
          aria-label="Extrusion depth"
          aria-valuenow={control.depth}
          aria-valuemin={CAD_THICKNESS_RANGE.min}
          aria-valuemax={Math.max(CAD_THICKNESS_RANGE.max, control.depth)}
          aria-valuetext={`${control.depth} mm`}
          aria-disabled={!control.editable}
          data-dragging={control.dragging || undefined}
          title={
            control.editable
              ? `${control.depth} mm — drag or use arrow keys to change depth`
              : `${control.depth} mm — depth follows the end condition or merge target`
          }
          onPointerDown={event => {
            event.stopPropagation();
            if (event.button !== 0 || !control.editable) return;
            event.preventDefault();
            const pixels = projectedAxis(),
              magnitude = pixels.length();
            const height =
              'isOrthographicCamera' in camera
                ? (camera as import('three').OrthographicCamera).top - (camera as import('three').OrthographicCamera).bottom
                : control.depth;
            const zoom = 'zoom' in camera ? Number(camera.zoom) : 1;
            drag.current = {
              pointerId: event.pointerId,
              start: ray(event.clientX, event.clientY),
              x: event.clientX,
              y: event.clientY,
              depth: control.depth,
              value: control.depth,
              pixels: magnitude > 0.01 ? pixels.normalize() : new Vector2(0, -1),
              millimetresPerPixel: magnitude > 0.01 ? 1 / magnitude : height / zoom / size.height,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            control.onStart();
          }}
          onPointerMove={event => {
            if (!drag.current || event.pointerId !== drag.current.pointerId) return;
            event.stopPropagation();
            drag.current.value = valueAt(event);
            control.onPreview(drag.current.value);
          }}
          onPointerUp={event => {
            if (!drag.current || event.pointerId !== drag.current.pointerId) return;
            event.stopPropagation();
            const value = valueAt(event);
            drag.current = null;
            control.onFinish(value);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}
          onKeyDown={event => {
            if (event.key === 'Escape' && drag.current) {
              event.preventDefault();
              event.stopPropagation();
              cancel();
              return;
            }
            const direction =
              event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? -1 : 0;
            if (!direction || !control.editable) return;
            event.preventDefault();
            event.stopPropagation();
            control.onFinish(clampExtrudeDepth(control.depth + direction * (event.shiftKey ? 10 : 1)));
          }}>
          <svg viewBox="0 0 24 32" width="24" height="32" aria-hidden="true" style={{ transform: `rotate(${angle}rad)` }}>
            <path d="M12 1 23 13H16V31H8V13H1Z" />
          </svg>
        </button>
      </Html>
    </>
  );
}
