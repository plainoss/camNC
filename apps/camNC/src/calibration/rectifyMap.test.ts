import { cv2, ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { Matrix3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { calculateUndistortionMapsCached } from './rectifyMap';

type Matrix3x3 = [[number, number, number], [number, number, number], [number, number, number]];

/** The maps OpenCV computes for the same camera, as the reference for the plain TypeScript implementation. */
function initUndistortRectifyMapCv(
  cameraMatrix: Matrix3x3,
  distCoeffs: number[],
  R: Matrix3x3,
  newCameraMatrix: Matrix3,
  size: { width: number; height: number }
): { map1: Float32Array; map2: Float32Array } {
  const { width, height } = size;
  const cameraMat = cv2.matFromArray(3, 3, cv2.CV_64F, cameraMatrix.flat());
  const distCoeffsMat = cv2.matFromArray(distCoeffs.length, 1, cv2.CV_64F, distCoeffs);
  const rotationMat = cv2.matFromArray(3, 3, cv2.CV_64F, R.flat());
  // Three.js stores matrices column-major, OpenCV row-major.
  const newCameraMat = cv2.matFromArray(3, 3, cv2.CV_64F, newCameraMatrix.clone().transpose().elements);
  const map1 = new cv2.Mat(height, width, cv2.CV_32FC1);
  const map2 = new cv2.Mat(height, width, cv2.CV_32FC1);

  cv2.initUndistortRectifyMap(cameraMat, distCoeffsMat, rotationMat, newCameraMat, new cv2.Size(width, height), cv2.CV_32FC1, map1, map2);

  const map1Data = new Float32Array(width * height);
  const map2Data = new Float32Array(width * height);
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      const index = i * width + j;
      map1Data[index] = map1.floatAt(i, j);
      map2Data[index] = map2.floatAt(i, j);
    }
  }

  for (const mat of [cameraMat, distCoeffsMat, rotationMat, newCameraMat, map1, map2]) mat.delete();
  return { map1: map1Data, map2: map2Data };
}

describe('calculateUndistortionMapsCached', () => {
  beforeAll(async () => {
    await ensureOpenCvIsLoaded();
  });

  it('matches cv.initUndistortRectifyMap', () => {
    const size = { width: 64, height: 48 };
    const K: Matrix3x3 = [
      [60, 0, 31.5],
      [0, 62, 23.5],
      [0, 0, 1],
    ];
    // biome-ignore format: keep the hand-aligned layout
    const Kthree = new Matrix3().set(
      K[0][0], K[0][1], K[0][2],
      K[1][0], K[1][1], K[1][2],
      K[2][0], K[2][1], K[2][2]
    );
    // biome-ignore format: keep the hand-aligned layout
    const newK = new Matrix3().set(
      55, 0, 30,
      0, 57, 22,
      0, 0, 1
    );
    const identity: Matrix3x3 = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const dist = [-0.25, 0.08, 0.001, -0.002, -0.01];

    const expected = initUndistortRectifyMapCv(K, dist, identity, newK, size);
    const calibration = { calibration_matrix: Kthree, new_camera_matrix: newK, distortion_coefficients: dist };
    const [mapX, mapY] = calculateUndistortionMapsCached(calibration, size.width, size.height);

    let maxDiff = 0;
    for (let i = 0; i < expected.map1.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(expected.map1[i] - mapX[i]), Math.abs(expected.map2[i] - mapY[i]));
    }
    expect(maxDiff).toBeLessThan(1e-3);
  });

  it('returns the cached maps until the calibration or the size changes', () => {
    const calibration = {
      calibration_matrix: new Matrix3().set(60, 0, 8, 0, 60, 6, 0, 0, 1),
      new_camera_matrix: new Matrix3().set(60, 0, 8, 0, 60, 6, 0, 0, 1),
      distortion_coefficients: [-0.1, 0, 0, 0],
    };
    const maps = calculateUndistortionMapsCached(calibration, 16, 12);
    expect(maps[0]).toHaveLength(16 * 12);
    expect(calculateUndistortionMapsCached(calibration, 16, 12)).toBe(maps);
    const resized = calculateUndistortionMapsCached(calibration, 8, 12);
    expect(resized[0]).toHaveLength(8 * 12);
    expect(calculateUndistortionMapsCached({ ...calibration }, 8, 12)).not.toBe(resized);
  });
});
