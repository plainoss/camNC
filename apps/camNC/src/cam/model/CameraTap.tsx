import { useThree } from '@react-three/fiber';
import type { RefObject } from 'react';
import type * as THREE from 'three';

/** Keeps the view's camera where code outside the canvas, such as a missed click, can read it. */
export function CameraTap({ cameraRef }: { cameraRef: RefObject<THREE.Camera | null> }) {
  cameraRef.current = useThree(state => state.camera);
  return null;
}
