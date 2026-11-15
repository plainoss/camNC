import { CalibrationResult, CapturedFrame, Corner, PatternSize } from './calibrationTypes';

/**
 * Converts corners from OpenCV format to our simpler format
 */
export function convertCorners(corners: any): Corner[] {
  const result: Corner[] = [];
  const numCorners = corners.rows;

  for (let i = 0; i < numCorners; i++) {
    result.push({
      x: corners.data32F[i * 2],
      y: corners.data32F[i * 2 + 1],
    });
  }

  return result;
}

/**
 * Creates a set of 3D object points for the calibration pattern
 */
export function createObjectPoints(patternSize: PatternSize, squareSize: number = 1.0): any {
  const { width, height } = patternSize;
  const numCorners = width * height;
  const cv = self.cv;

  const objp = new cv.Mat(numCorners, 1, cv.CV_32FC3);
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      const index = i * width + j;
      objp.data32F[index * 3] = j * squareSize;
      objp.data32F[index * 3 + 1] = i * squareSize;
      objp.data32F[index * 3 + 2] = 0;
    }
  }

  return objp;
}

/**
 * Performs camera calibration using the captured frames
 */
export function calibrateCamera(
  capturedFrames: CapturedFrame[],
  patternSize: PatternSize,
  frameSize: { width: number; height: number },
  squareSize: number = 1.0,
  zeroTangentDist = false
): CalibrationResult {
  if (capturedFrames.length < 3) {
    throw new Error('At least 3 frames required for calibration');
  }
  console.log('calibrateCamera: %d frames, zeroTangentDist: %s', capturedFrames.length, zeroTangentDist);

  const cv = self.cv;
  const imageSize = new cv.Size(frameSize.width, frameSize.height);

  // Prepare MatVectors for object and image points
  const objectPoints = new cv.MatVector();
  const imagePoints = new cv.MatVector();

  // Matrices to hold calibration results
  const cameraMatrix = new cv.Mat();
  const distCoeffs = new cv.Mat();
  const rvecs = new cv.MatVector();
  const tvecs = new cv.MatVector();

  const stdDevInt = new cv.Mat();
  const stdDevExt = new cv.Mat();
  const perViewErrors = new cv.Mat();
  let newCameraMatrix: any = null;

  try {
    // Add points from captured frames. push_back copies, so free the local Mats right away.
    capturedFrames.forEach(() => {
      const objp = createObjectPoints(patternSize, squareSize);
      objectPoints.push_back(objp);
      objp.delete();
    });

    capturedFrames.forEach(frame => {
      // Convert our corner format back to OpenCV format
      const points = new cv.Mat(frame.corners.length, 1, cv.CV_32FC2);
      frame.corners.forEach((corner, i) => {
        points.data32F[i * 2] = corner.x;
        points.data32F[i * 2 + 1] = corner.y;
      });
      imagePoints.push_back(points);
      points.delete();
    });

    const crit = new cv.TermCriteria(cv.TermCriteria.COUNT + cv.TermCriteria.EPS, 30, 1e-6);

    const flags = zeroTangentDist ? cv.CALIB_ZERO_TANGENT_DIST : 0;
    // Calibrate the camera
    const rms = cv.calibrateCameraExtended(
      objectPoints,
      imagePoints,
      imageSize,
      cameraMatrix,
      distCoeffs,
      rvecs,
      tvecs,
      stdDevInt,
      stdDevExt,
      perViewErrors,
      flags,
      crit
    );

    // Get optimal new camera matrix
    newCameraMatrix = cv.getOptimalNewCameraMatrix(cameraMatrix, distCoeffs, imageSize, 0.3);

    // Convert matrices to JS arrays
    const result: CalibrationResult = {
      rms,
      cameraMatrix: matToArray(cameraMatrix),
      distCoeffs: matToArray(distCoeffs)[0] || [],
      newCameraMatrix: matToArray(newCameraMatrix),
      perViewErrors: matToArray(perViewErrors).map(row => row[0]) as number[],
    };
    return result;
  } finally {
    // Clean up
    objectPoints.delete();
    imagePoints.delete();
    cameraMatrix.delete();
    distCoeffs.delete();
    rvecs.delete();
    tvecs.delete();
    newCameraMatrix?.delete();
    stdDevInt.delete();
    stdDevExt.delete();
    perViewErrors.delete();
  }
}

/**
 * Converts OpenCV Mat to JS array
 */
function matToArray(mat: any): number[][] {
  const rows = mat.rows;
  const cols = mat.cols;
  const result: number[][] = [];

  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      const value = mat.data64F ? mat.data64F[i * cols + j] : mat.data32F[i * cols + j];
      row.push(value);
    }
    result.push(row);
  }

  return result;
}
