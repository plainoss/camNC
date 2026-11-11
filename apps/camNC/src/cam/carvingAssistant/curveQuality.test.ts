import { describe, expect, it } from 'vitest';
import { traceCarvingPng } from './rasterSource';
import { prepareCarvingArt } from './prepare';
import { carvingBoard, kDefaultVBit } from '../carving';

type Point = { x: number; y: number };
function maximumCubicJoinAngle(svg: string): number {
  const d = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('path')!.getAttribute('d')!;
  const tokens = d.match(/[MLCZ]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi)!;
  const paths: { type: string; a: Point; first: Point; last: Point; b: Point }[][] = [];
  let point = { x: 0, y: 0 },
    index = 0;
  const next = () => ({ x: Number(tokens[index++]), y: Number(tokens[index++]) });
  while (index < tokens.length) {
    const type = tokens[index++];
    if (type === 'M') {
      point = next();
      paths.push([]);
    } else if (type === 'C') {
      const first = next(),
        last = next(),
        b = next();
      paths.at(-1)!.push({ type, a: point, first, last, b });
      point = b;
    } else if (type === 'L') {
      const b = next();
      paths.at(-1)!.push({ type, a: point, first: b, last: point, b });
      point = b;
    }
  }
  let maximum = 0;
  for (const path of paths)
    for (let i = 0; i < path.length; i++) {
      const before = path[i],
        after = path[(i + 1) % path.length];
      if (before.type !== 'C' || after.type !== 'C') continue;
      const a = [before.b.x - before.last.x, before.b.y - before.last.y],
        b = [after.first.x - after.a.x, after.first.y - after.a.y];
      const length = Math.hypot(...a) * Math.hypot(...b);
      if (length < 1e-9) continue;
      maximum = Math.max(maximum, (Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / length))) * 180) / Math.PI);
    }
  return maximum;
}
function artwork(width: number, height: number, paint: (context: CanvasRenderingContext2D) => void): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'white';
  context.fillRect(0, 0, width, height);
  paint(context);
  return canvas.toDataURL('image/png').split(',')[1];
}
const constraints = { widthMm: 80, heightMm: 80, detail: 'simple' as const, minFeatureMm: 1 };

describe('analytical smooth vector quality', () => {
  it.each(['circle', 'ellipse', 'S curve'])('keeps gentle cubic joins tangent-continuous for a smooth %s', async shape => {
    const source = artwork(512, 512, context => {
      context.fillStyle = 'black';
      if (shape === 'S curve') {
        context.strokeStyle = 'black';
        context.lineWidth = 32;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(50, 256);
        context.bezierCurveTo(150, 30, 350, 480, 460, 256);
        context.stroke();
      } else {
        context.beginPath();
        context.ellipse(256, 256, 200, shape === 'circle' ? 200 : 140, 0, 0, Math.PI * 2);
        context.fill();
      }
    });
    const result = await traceCarvingPng(source, constraints);
    expect(result.svg).toContain('C');
    expect(result.traceReport!.intersectionOverUnion).toBeGreaterThan(0.96);
    expect(result.traceReport!.boundaryErrorMm).toBeLessThan(0.5);
    expect(maximumCubicJoinAngle(result.svg)).toBeLessThan(0.25);
  });

  it('refuses a low-resolution round fit with an artificial dent or produces a tangent-continuous result', async () => {
    const source = artwork(64, 64, context => {
      context.fillStyle = 'black';
      context.beginPath();
      context.arc(32, 32, 21, 0, Math.PI * 2);
      context.fill();
    });
    let result;
    try {
      result = await traceCarvingPng(source, { ...constraints, widthMm: 16, heightMm: 16, minFeatureMm: 3 });
    } catch (error) {
      expect(String(error)).toMatch(/curve-fitting dent|coverage or boundary|resolution/);
      return;
    }
    expect(maximumCubicJoinAngle(result.svg)).toBeLessThan(0.25);
    expect(result.traceReport!.boundaryErrorMm).toBeLessThan(1);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', new DOMParser().parseFromString(result.svg, 'image/svg+xml').querySelector('path')!.getAttribute('d')!);
    const length = path.getTotalLength();
    for (let i = 0; i < 1024; i++) {
      const point = path.getPointAtLength((length * i) / 1024);
      expect(Math.abs(Math.hypot(point.x - 32, point.y - 32) - 21)).toBeLessThan(0.02);
    }
  });

  it('smooths round pupils and counters inside a complex image rather than only recognizing an isolated circle', async () => {
    const source = artwork(256, 256, context => {
      context.fillStyle = 'black';
      context.fillRect(15, 15, 80, 200);
      context.fillStyle = 'white';
      context.beginPath();
      context.arc(55, 70, 21, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'black';
      context.beginPath();
      context.arc(160, 120, 21, 0, Math.PI * 2);
      context.fill();
      context.fillRect(140, 180, 70, 20);
    });
    const result = await traceCarvingPng(source, { ...constraints, widthMm: 60, heightMm: 60 });
    expect(result.traceReport).toMatchObject({ components: 3, holes: 1, roundRegularized: true });
    expect(maximumCubicJoinAngle(result.svg)).toBeLessThan(0.25);
    expect(result.traceReport!.intersectionOverUnion).toBeGreaterThan(0.98);
    expect(result.warnings.join(' ')).toContain('round pupils or counters');
  });

  it('keeps final direct-source CAM polygons within 0.05 mm of the smooth circular source', async () => {
    const source = artwork(400, 400, context => {
      context.fillStyle = 'black';
      context.beginPath();
      context.arc(200, 200, 150, 0, Math.PI * 2);
      context.fill();
    });
    const traced = await traceCarvingPng(source, constraints);
    const result = await prepareCarvingArt({
      art: { kind: 'svg', svg: traced.svg, fileName: 'circle.svg' },
      sourceOutline: traced.sourceOutline,
      width: 80,
      height: 80,
      detail: 'detailed',
      carving: { items: [], region: [], vBit: kDefaultVBit, maxDepth: 2, clearWithFlat: false },
      board: carvingBoard({ w: 100, h: 100, thickness: 18 }),
    });
    expect(result.report.ok).toBe(true);
    const points = traced.sourceOutline!.flat(),
      xs = points.map(p => p.x),
      ys = points.map(p => p.y);
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys);
    const scale = Math.min(80 / (x1 - x0), 80 / (y1 - y0));
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', new DOMParser().parseFromString(traced.svg, 'image/svg+xml').querySelector('path')!.getAttribute('d')!);
    const length = path.getTotalLength();
    let maximum = 0;
    for (let i = 0; i < 2048; i++) {
      const p = path.getPointAtLength((length * i) / 2048),
        x = ((p.x - 200) / 3.75 - (x0 + x1) / 2) * scale,
        y = ((200 - p.y) / 3.75 - (y0 + y1) / 2) * scale;
      let nearest = Infinity;
      for (const loop of result.outline)
        for (let k = 0; k < loop.length; k++) {
          const a = loop[k],
            b = loop[(k + 1) % loop.length],
            dx = b.x - a.x,
            dy = b.y - a.y,
            squared = dx * dx + dy * dy;
          const t = squared ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / squared)) : 0;
          nearest = Math.min(nearest, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
        }
      maximum = Math.max(maximum, nearest);
    }
    expect(maximum).toBeLessThanOrEqual(0.05);
  });
});
