import { CalibrationData } from '@/store/store';

/**
 * Computes the undistortion maps of a camera: for every pixel of the undistorted image, the x and y position of that
 * pixel in the distorted camera image.
 *
 * Mirrors cv.initUndistortRectifyMap
 * (https://docs.opencv.org/3.4/da/d54/group__imgproc__transform.html#ga7dfb72c9cf9780a347fbe3d1c47e5d5a) with an
 * identity rectification rotation, implemented in plain TypeScript so OpenCV does not have to load at startup.
 */
function computeMaps(calibration: CalibrationData, width: number, height: number): [Float32Array, Float32Array] {
  const { calibration_matrix, new_camera_matrix, distortion_coefficients } = calibration;
  const mapX = new Float32Array(width * height);
  const mapY = new Float32Array(width * height);

  const fx_new = new_camera_matrix.elements[0],
    cx_new = new_camera_matrix.elements[6],
    fy_new = new_camera_matrix.elements[4],
    cy_new = new_camera_matrix.elements[7];

  const fx = calibration_matrix.elements[0],
    cx = calibration_matrix.elements[6],
    fy = calibration_matrix.elements[4],
    cy = calibration_matrix.elements[7];

  // [k1, k2, p1, p2, (optional) k3]
  const k1 = distortion_coefficients[0] || 0;
  const k2 = distortion_coefficients[1] || 0;
  const p1 = distortion_coefficients[2] || 0;
  const p2 = distortion_coefficients[3] || 0;
  const k3 = distortion_coefficients.length >= 5 ? distortion_coefficients[4] : 0;

  for (let i = 0; i < width * height; i++) {
    const u = i % width;
    const v = Math.floor(i / width);

    // 1. Normalize pixel coordinates using the new camera matrix.
    const x = (u - cx_new) / fx_new;
    const y = (v - cy_new) / fy_new;

    // 2. Apply distortion.
    const r2 = x * x + y * y;
    const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
    const deltaX = 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
    const deltaY = p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
    const xDistorted = x * radial + deltaX;
    const yDistorted = y * radial + deltaY;

    // 3. Reproject using the original camera matrix.
    mapX[i] = fx * xDistorted + cx;
    mapY[i] = fy * yDistorted + cy;
  }

  return [mapX, mapY];
}

let lastCalibrationData: CalibrationData | null = null;
let lastWidth: number | null = null;
let lastHeight: number | null = null;
let lastUndistortionMaps: [Float32Array, Float32Array] | null = null;

/** The X and Y undistortion maps of a camera, cached for the most recent arguments. */
export function calculateUndistortionMapsCached(
  calibrationData: CalibrationData,
  width: number,
  height: number
): [Float32Array, Float32Array] {
  if (calibrationData === lastCalibrationData && width === lastWidth && height === lastHeight && lastUndistortionMaps) {
    return lastUndistortionMaps;
  }
  lastCalibrationData = calibrationData;
  lastWidth = width;
  lastHeight = height;
  lastUndistortionMaps = computeMaps(calibrationData, width, height);
  return lastUndistortionMaps;
}
