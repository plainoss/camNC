export interface Corner {
  x: number;
  y: number;
}

export interface CapturedFrame {
  id: string;
  imageBlob: Blob | null;
  corners: Corner[];
  timestamp: number;
  perViewError?: number;
}

export interface CalibrationResult {
  rms: number;
  cameraMatrix: number[][];
  distCoeffs: number[];
  newCameraMatrix: number[][];
  perViewErrors: number[];
}

export interface PatternSize {
  width: number;
  height: number;
}

declare global {
  interface Window {
    cv: any;
  }
}
