import { cv2 } from '@wbcnc/load-opencv';
import { Matrix3, Vector3 } from 'three';

/**
 * Converts a Three.js Matrix3 to an OpenCV Mat.
 * Note: Three.js matrices are stored in column-major order, while OpenCV uses row-major order.
 *
 * @param matrix - Three.js Matrix3 to convert
 * @param type - OpenCV matrix type (cv2.CV_32F or cv2.CV_64F)
 * @returns OpenCV Mat with the same values
 */
export function matrix3ToCV(matrix: Matrix3, type: number = cv2.CV_64F): cv2.Mat {
  // Extract elements from Three.js Matrix3 (column-major)
  const elements = matrix.elements;

  // Rearrange to row-major for OpenCV
  // biome-ignore format: keep the hand-aligned layout
  const rowMajorData = [
    elements[0], elements[3], elements[6], // First row
    elements[1], elements[4], elements[7], // Second row
    elements[2], elements[5], elements[8]  // Third row
  ];

  // Create an OpenCV Mat with the appropriate type
  return cv2.matFromArray(3, 3, type, rowMajorData);
}

/**
 * Converts an OpenCV Mat to a Three.js Matrix3.
 * Note: Three.js matrices are stored in column-major order, while OpenCV uses row-major order.
 *
 * @param cvMat - OpenCV Mat to convert (must be 3x3)
 * @returns Three.js Matrix3 with the same values
 */
export function cvToMatrix3(cvMat: cv2.Mat): Matrix3 {
  // Check dimensions
  if (cvMat.rows !== 3 || cvMat.cols !== 3) {
    throw new Error('OpenCV matrix must be 3x3 to convert to Three.js Matrix3');
  }

  let data: Float32Array | Float64Array;

  // Get the appropriate data array based on matrix type
  if (cvMat.type() === cv2.CV_32F) {
    data = cvMat.data32F;
  } else if (cvMat.type() === cv2.CV_64F) {
    data = cvMat.data64F;
  } else {
    throw new Error('Unsupported OpenCV matrix type. Must be CV_32F or CV_64F');
  }

  // Convert from row-major (OpenCV) to column-major (Three.js)
  // biome-ignore format: keep the hand-aligned layout
  return new Matrix3().set(
    data[0], data[1], data[2],
    data[3], data[4], data[5],
    data[6], data[7], data[8]
  );
}

/**
 * Converts a Three.js Vector3 to an OpenCV 3x1 Mat.
 *
 * @param vector - Three.js Vector3 to convert
 * @param type - OpenCV matrix type (cv2.CV_32F or cv2.CV_64F)
 * @returns OpenCV Mat with the same values
 */
export function vector3ToCV(vector: Vector3, type: number = cv2.CV_64F): cv2.Mat {
  // Create a 3x1 matrix with the vector components
  return cv2.matFromArray(3, 1, type, [vector.x, vector.y, vector.z]);
}

/**
 * Converts an OpenCV 3x1 or 1x3 Mat to a Three.js Vector3.
 *
 * @param cvMat - OpenCV Mat to convert (must be 3x1 or 1x3)
 * @returns Three.js Vector3 with the same values
 */
export function cvToVector3(cvMat: cv2.Mat): Vector3 {
  // Check dimensions
  if (!((cvMat.rows === 3 && cvMat.cols === 1) || (cvMat.rows === 1 && cvMat.cols === 3))) {
    throw new Error('OpenCV matrix must be 3x1 or 1x3 to convert to Three.js Vector3');
  }

  let data: Float32Array | Float64Array;

  // Get the appropriate data array based on matrix type
  if (cvMat.type() === cv2.CV_32F) {
    data = cvMat.data32F;
  } else if (cvMat.type() === cv2.CV_64F) {
    data = cvMat.data64F;
  } else {
    throw new Error('Unsupported OpenCV matrix type. Must be CV_32F or CV_64F');
  }

  return new Vector3(data[0], data[1], data[2]);
}
