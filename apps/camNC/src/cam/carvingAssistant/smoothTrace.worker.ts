import tracer from 'imagetracerjs';
import { flattenCurveContours, kMaxOutlinePoints } from './curveFlatten';
import { mergeCurveRuns } from './curveMerge';
import { smoothCurveJoins } from './curveSmoothing';
import { regularizeRoundTrace } from './roundTraceQuality';

// A detailed 1024 px line-art illustration takes about 2800 merged segments and 150 contours. At about 40 characters
// per cubic, the 170,000-character path cap below binds at a similar count.
const kMaxSegments = 4000;

self.onmessage = (
  event: MessageEvent<{
    ink: Uint8Array;
    width: number;
    height: number;
    tolerancePx: number;
    chordTolerancePx: number;
    microCornerSpanPx?: number;
  }>
) => {
  try {
    const { ink, width, height, tolerancePx } = event.data;
    if (width * height > 1_000_000 || ink.length !== width * height) throw new Error('Smooth trace input exceeds its pixel budget.');
    const data = new Uint8ClampedArray(ink.length * 4);
    for (let i = 0; i < ink.length; i++) {
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = ink[i] ? 0 : 255;
      data[i * 4 + 3] = 255;
    }
    // Retain the pinned tracer's pre-fit contour samples for per-contour primitive checks. This includes holes
    // and isolated pupils inside a larger illustration; fitting decisions must not depend on the whole image.
    const originalTracePath = tracer.tracepath.bind(tracer);
    let sourcePointCount = 0;
    tracer.tracepath = (path, lineTolerance, curveTolerance) => {
      if ((sourcePointCount += path.points.length) > 120_000) throw new Error('Smooth tracing exceeds its source contour budget.');
      return { ...originalTracePath(path, lineTolerance, curveTolerance), sourcePoints: path.points };
    };
    const traced = tracer.imagedataToTracedata(
      { width, height, data },
      {
        pal: [
          { r: 0, g: 0, b: 0, a: 255 },
          { r: 255, g: 255, b: 255, a: 255 },
        ],
        colorsampling: 0,
        colorquantcycles: 1,
        mincolorratio: 0,
        layering: 0,
        pathomit: 0,
        linefilter: false,
        rightangleenhance: true,
        ltres: 0.1,
        qtres: tolerancePx * tolerancePx,
        blurradius: 0,
      }
    );
    // Merge the tracer's short segments within half the fit tolerance; the raster checks measure the result again.
    const roundFit = regularizeRoundTrace(
      mergeCurveRuns(smoothCurveJoins(traced.layers[0], tolerancePx / 3, event.data.microCornerSpanPx), tolerancePx / 2)
    );
    const paths = roundFit.paths;
    const segmentCount = paths.reduce((sum, path) => sum + path.segments.length, 0);
    if (!paths.length || paths.length > 300 || segmentCount > kMaxSegments)
      throw new Error('Smooth tracing exceeds its contour budget. Use simpler artwork.');
    let curves = 0,
      lines = 0;
    const number = (value: number | undefined) => {
      if (value === undefined || !Number.isFinite(value) || Math.abs(value) > 1e6)
        throw new Error('Smooth tracer returned an invalid coordinate.');
      // A hundredth of a tracing pixel is far below what the source resolves, and keeps a detailed trace compact.
      return Number(value.toFixed(2));
    };
    const d = paths
      .map(path => {
        const first = path.segments[0];
        let endpoint = { x: first.x1, y: first.y1 };
        for (const segment of path.segments) {
          if (Math.hypot(segment.x1 - endpoint.x, segment.y1 - endpoint.y) > 1e-6)
            throw new Error('Smooth tracer returned a discontinuous contour.');
          endpoint = segment.type === 'C' ? { x: segment.x4!, y: segment.y4! } : { x: segment.x2, y: segment.y2 };
        }
        if (Math.hypot(endpoint.x - first.x1, endpoint.y - first.y1) > 1e-3) throw new Error('Smooth tracer returned an open contour.');
        return (
          `M${number(first.x1)},${number(first.y1)}` +
          path.segments
            .map(segment => {
              if (segment.type === 'C') {
                curves++;
                return `C${number(segment.x2)},${number(segment.y2)} ${number(segment.x3)},${number(segment.y3)} ${number(segment.x4)},${number(segment.y4)}`;
              }
              if (segment.type !== 'L') throw new Error('Unsupported tracer segment.');
              lines++;
              return `L${number(segment.x2)},${number(segment.y2)}`;
            })
            .join('') +
          'Z'
        );
      })
      .join('');
    if (d.length > 170_000) throw new Error('Smooth vector source exceeds its encoded geometry budget.');
    const holes = paths.filter(path => path.isholepath).length;
    // Emit only checked numeric path data. Never import or insert the library's generated SVG markup.
    self.postMessage({
      d,
      curves,
      lines,
      components: paths.length - holes,
      holes,
      outline: flattenCurveContours(paths, event.data.chordTolerancePx, kMaxOutlinePoints),
      roundRegularized: roundFit.regularized,
    });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Smooth tracing failed.' });
  }
};
