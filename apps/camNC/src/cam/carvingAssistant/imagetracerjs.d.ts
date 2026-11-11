declare module 'imagetracerjs' {
  interface Segment {
    type: 'L' | 'Q';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    x3?: number;
    y3?: number;
  }
  interface SourcePath {
    points: { x: number; y: number }[];
  }
  interface TracePath {
    segments: Segment[];
    isholepath: boolean;
    sourcePoints?: { x: number; y: number }[];
  }
  const tracer: {
    imagedataToTracedata(
      image: { width: number; height: number; data: Uint8ClampedArray },
      options: Record<string, unknown>
    ): { layers: TracePath[][] };
    tracepath(path: SourcePath, lineTolerance: number, curveTolerance: number): TracePath;
  };
  export default tracer;
}
