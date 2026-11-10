import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Raycaster, Vector2, Vector3, type Box3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { kCadMouseButtons, kOrbitDamping } from '@/lib/orbitDamping';
import { pickOrbitPivot } from './orbitPicking';

/** Turn about the geometry under the initial press, or the visible bounds for a background press. */
export function ModelOrbitControls({ box, enabled = true }: { box: Box3; enabled?: boolean }) {
  const controls = useThree(s => s.controls) as OrbitControlsImpl | null;
  const scene = useThree(s => s.scene);
  const bounds = useRef(box);
  bounds.current = box;
  useEffect(() => {
    const element = controls?.domElement;
    if (!controls || !element) return;
    const camera = controls.object;
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const lastRotation = camera.quaternion.clone();
    const lastPosition = camera.position.clone();
    const lastTarget = controls.target.clone();
    const offset = new Vector3();
    const correction = new Vector3();
    let pivot: Vector3 | null = null;
    const press = (event: PointerEvent) => {
      pivot = null;
      // Modified right-drags pan in OrbitControls; disabled depth grips and touch must keep their own gestures.
      if (!controls.enabled || event.pointerType === 'touch' || event.button !== 2 || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld();
      raycaster.setFromCamera(pointer, camera);
      pivot = pickOrbitPivot(raycaster, scene, bounds.current);
      if (pivot) offset.copy(pivot).sub(camera.position).applyQuaternion(camera.quaternion.clone().invert());
      lastPosition.copy(camera.position);
      lastRotation.copy(camera.quaternion);
      lastTarget.copy(controls.target);
    };
    const update = controls.update;
    // OrbitControls also uses its target as the camera's look-at point. Moving that target to the hit would
    // recenter the picture. Correct each rotation about the separate pivot instead, including damping updates.
    controls.update = () => {
      // A fit, named view or restored sketch camera explicitly replaces the view and its previous anchor.
      if (!camera.position.equals(lastPosition) || !camera.quaternion.equals(lastRotation) || !controls.target.equals(lastTarget))
        pivot = null;
      const changed = update();
      if (pivot) {
        // Keeping the hit in the same camera coordinates also cancels a previous pan's remaining inertia.
        correction.copy(offset).applyQuaternion(camera.quaternion).add(camera.position).negate().add(pivot);
        camera.position.add(correction);
        controls.target.add(correction);
        camera.updateMatrixWorld();
      }
      lastPosition.copy(camera.position);
      lastRotation.copy(camera.quaternion);
      lastTarget.copy(controls.target);
      return changed;
    };
    element.addEventListener('pointerdown', press, true);
    const clear = () => {
      pivot = null;
    };
    element.addEventListener('wheel', clear, true);
    element.addEventListener('pointercancel', clear, true);
    return () => {
      controls.update = update;
      element.removeEventListener('pointerdown', press, true);
      element.removeEventListener('wheel', clear, true);
      element.removeEventListener('pointercancel', clear, true);
    };
  }, [scene, controls]);
  return <OrbitControls makeDefault enabled={enabled} dampingFactor={kOrbitDamping} mouseButtons={kCadMouseButtons} />;
}
