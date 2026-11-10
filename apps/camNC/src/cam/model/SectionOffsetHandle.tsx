import { Html, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Raycaster, Vector2, Vector3 } from 'three';
import { distanceAlongAxis } from '@/cad/extrudeDepth';
import './sectionOffsetHandle.css';

type Vec3 = [number, number, number];
export interface SectionOffsetControl {
  origin: Vec3;
  normal: Vec3;
  offset: number;
  /** The offset is measured along the source plane normal even after the retained side is flipped. */
  factor: number;
  dragging: boolean;
  onStart: () => void;
  onPreview: (offset: number) => void;
  onStep: (delta: number) => void;
  onFinish: () => void;
  onCancel: () => void;
}
interface Drag {
  id: number;
  x: number;
  y: number;
  origin: Vec3;
  normal: Vec3;
  offset: number;
  at: number | null;
  pixels: Vector2;
  millimetresPerPixel: number;
  factor: number;
  moved: boolean;
}

/** A constant-screen-size normal handle moves only the temporary section plane. */
export function SectionOffsetHandle({ control }: { control: SectionOffsetControl }) {
  const { camera, gl, size } = useThree();
  const button = useRef<HTMLButtonElement>(null),
    drag = useRef<Drag | null>(null);
  const [angle, setAngle] = useState(0);
  const origin = new Vector3(...control.origin),
    axis = new Vector3(...control.normal).normalize();
  const projected = () => {
    camera.updateMatrixWorld();
    const a = origin.clone().project(camera),
      b = origin.clone().add(axis).project(camera);
    return new Vector2(((b.x - a.x) * size.width) / 2, (-(b.y - a.y) * size.height) / 2);
  };
  useFrame(() => {
    const direction = projected();
    const next = direction.length() > 0.01 ? Math.atan2(direction.y, direction.x) + Math.PI / 2 : 0;
    setAngle(previous => (Math.abs(previous - next) > 1e-4 ? next : previous));
  });
  const direction = projected(),
    units = direction.length() > 0.01 ? 30 / direction.length() : 10;
  const end = origin.clone().addScaledVector(axis, units);
  const along = (x: number, y: number, at: Vec3, normal: Vec3) => {
    const box = gl.domElement.getBoundingClientRect(),
      cast = new Raycaster();
    cast.setFromCamera(new Vector2(((x - box.left) / box.width) * 2 - 1, 1 - ((y - box.top) / box.height) * 2), camera);
    return distanceAlongAxis(cast.ray.origin.toArray(), cast.ray.direction.toArray(), at, normal);
  };
  const release = () => {
    const moving = drag.current;
    drag.current = null;
    if (moving && button.current?.hasPointerCapture(moving.id)) button.current.releasePointerCapture(moving.id);
  };
  useEffect(() => {
    if (!control.dragging) release();
  }, [control.dragging]);
  const valueAt = (event: PointerEvent<HTMLButtonElement>) => {
    const moving = drag.current!;
    if (Math.hypot(event.clientX - moving.x, event.clientY - moving.y) < 2) return moving.offset;
    const at = along(event.clientX, event.clientY, moving.origin, moving.normal);
    const delta =
      moving.at !== null && at !== null
        ? at - moving.at
        : new Vector2(event.clientX - moving.x, event.clientY - moving.y).dot(moving.pixels) * moving.millimetresPerPixel;
    return moving.offset + delta * moving.factor;
  };
  return (
    <>
      <Line points={[control.origin, end.toArray()]} color="#e3a735" lineWidth={2} depthTest={false} raycast={() => {}} />
      <Html center position={end.toArray()} zIndexRange={[5, 0]}>
        <button
          ref={button}
          type="button"
          role="slider"
          className="cad-section-offset-handle"
          aria-label="Section offset"
          aria-valuenow={control.offset}
          aria-valuetext={`${control.offset} mm`}
          title={`${control.offset} mm — drag along the normal or use arrow keys`}
          onPointerDown={event => {
            event.stopPropagation();
            if (event.button !== 0) return;
            event.preventDefault();
            const pixels = projected(),
              magnitude = pixels.length();
            const height =
              'isOrthographicCamera' in camera
                ? (camera as import('three').OrthographicCamera).top - (camera as import('three').OrthographicCamera).bottom
                : 100;
            const zoom = 'zoom' in camera ? Number(camera.zoom) : 1;
            drag.current = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              origin: control.origin,
              normal: control.normal,
              moved: false,
              offset: control.offset,
              at: along(event.clientX, event.clientY, control.origin, control.normal),
              pixels: magnitude > 0.01 ? pixels.normalize() : new Vector2(0, -1),
              millimetresPerPixel: magnitude > 0.01 ? 1 / magnitude : height / zoom / size.height,
              factor: control.factor,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.focus({ preventScroll: true });
            control.onStart();
          }}
          onPointerMove={event => {
            const moving = drag.current;
            if (event.pointerId !== moving?.id) return;
            event.stopPropagation();
            // Hand jitter must not replace a precise or expression-backed value with a numeric edit.
            if (!moving.moved && Math.hypot(event.clientX - moving.x, event.clientY - moving.y) < 2) return;
            moving.moved = true;
            control.onPreview(valueAt(event));
          }}
          onPointerUp={event => {
            if (event.pointerId !== drag.current?.id) return;
            event.stopPropagation();
            if (drag.current.moved || Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) >= 2)
              control.onPreview(valueAt(event));
            release();
            control.onFinish();
          }}
          onPointerCancel={() => {
            if (drag.current) {
              release();
              control.onCancel();
            }
          }}
          onLostPointerCapture={() => {
            if (drag.current) {
              release();
              control.onCancel();
            }
          }}
          onClick={event => event.stopPropagation()}
          onKeyDown={event => {
            if (event.key === 'Escape' && drag.current) {
              event.preventDefault();
              event.stopPropagation();
              release();
              control.onCancel();
            } else if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) {
              // Modified arrows belong to browser navigation and text/IME commands, not this view edit.
              if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
                return;
              event.preventDefault();
              event.stopPropagation();
              const sign = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1;
              control.onStep(sign * (event.shiftKey ? 10 : 1));
            }
          }}>
          <svg viewBox="0 0 24 36" aria-hidden="true" style={{ transform: `rotate(${angle}rad)` }}>
            <path d="M12 2 3 16h6v18h6V16h6z" />
          </svg>
        </button>
      </Html>
    </>
  );
}
