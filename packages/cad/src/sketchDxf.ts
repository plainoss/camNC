import { isNurbsCurve, rationalCurveData, tessellateCurve } from './curves';
import {
  cadLengthUnitMm,
  clampedCurveData,
  formatExportNumber,
  sketchExportCurves,
  type SketchExportCurve,
  type SketchExportOptions,
} from './sketchExport';
import type { CadEllipseEntity, CadLengthUnit, CadPoint, CadSketch } from './types';

export interface SketchDxfOptions extends SketchExportOptions {
  /** Write every curve but lines, circles and arcs as a polyline, for readers without SPLINE or ELLIPSE. */
  splinesAsPolylines?: boolean;
  /** Polyline chord tolerance in mm. */
  tolerance?: number;
}

/** DXF's $INSUNITS codes. */
const insUnits: Record<CadLengthUnit, number> = { mm: 4, cm: 5, m: 6, in: 1, ft: 2 };
const SKETCH_LAYER = 'SKETCH',
  CONSTRUCTION_LAYER = 'CONSTRUCTION';

/**
 * The sketch as an AutoCAD 2000 (AC1015) DXF: the oldest version with SPLINE, ELLIPSE and LWPOLYLINE, so curves stay
 * exact. Coordinates are in the sketch's own frame, converted to `unit`, with Z = 0.
 */
export function sketchToDxf(sketch: CadSketch, options: SketchDxfOptions = {}): string {
  const unit = options.unit ?? 'mm',
    scale = 1 / cadLengthUnitMm[unit];
  const points = new Map<string, CadPoint>();
  for (const entity of sketch.entities) if (entity.type === 'point') points.set(entity.id, entity);
  const curves = sketchExportCurves(sketch, options.construction);

  const out: string[] = [];
  const tag = (code: number, value: string | number) =>
    out.push(String(code), typeof value === 'number' ? (Number.isInteger(value) ? String(value) : formatExportNumber(value)) : value);
  const length = (value: number) => formatExportNumber(value * scale);
  const xy = (code: number, p: CadPoint) => {
    tag(code, length(p.x));
    tag(code + 10, length(p.y));
    tag(code + 20, '0');
  };
  let nextHandle = 1;
  const handle = () => (nextHandle++).toString(16).toUpperCase();

  // Handles are fixed up front so tables can point at what they own.
  const h = {
    vportTable: handle(),
    vport: handle(),
    ltypeTable: handle(),
    byBlock: handle(),
    byLayer: handle(),
    continuous: handle(),
    dashed: handle(),
    layerTable: handle(),
    layer0: handle(),
    sketchLayer: handle(),
    constructionLayer: handle(),
    styleTable: handle(),
    style: handle(),
    viewTable: handle(),
    ucsTable: handle(),
    appidTable: handle(),
    appid: handle(),
    dimstyleTable: handle(),
    dimstyle: handle(),
    blockRecordTable: handle(),
    modelRecord: handle(),
    paperRecord: handle(),
    modelBlock: handle(),
    modelBlockEnd: handle(),
    paperBlock: handle(),
    paperBlockEnd: handle(),
    rootDictionary: handle(),
    groupDictionary: handle(),
  };

  const entities: string[] = [];
  {
    const saved = out.splice(0);
    for (const curve of curves) writeCurve(curve);
    entities.push(...out.splice(0));
    out.push(...saved);
  }

  function entityStart(type: string, curve: SketchExportCurve, subclass: string) {
    tag(0, type);
    tag(5, handle());
    tag(330, h.modelRecord);
    tag(100, 'AcDbEntity');
    tag(8, curve.construction ? CONSTRUCTION_LAYER : SKETCH_LAYER);
    tag(100, subclass);
  }
  function polyline(curve: SketchExportCurve, vertices: CadPoint[]) {
    const closed = vertices.length > 2 && Math.hypot(vertices[0]!.x - vertices.at(-1)!.x, vertices[0]!.y - vertices.at(-1)!.y) < 1e-9;
    const list = closed ? vertices.slice(0, -1) : vertices;
    entityStart('LWPOLYLINE', curve, 'AcDbPolyline');
    tag(90, list.length);
    tag(70, closed ? 1 : 0);
    tag(43, '0');
    for (const p of list) {
      tag(10, length(p.x));
      tag(20, length(p.y));
    }
  }
  function ellipse(curve: SketchExportCurve, entity: CadEllipseEntity) {
    const c = points.get(entity.centerId)!,
      f = points.get(entity.focusId)!;
    const focal = Math.hypot(f.x - c.x, f.y - c.y),
      a = Math.hypot(focal, entity.radius);
    const ux = focal ? (f.x - c.x) / focal : 1,
      uy = focal ? (f.y - c.y) / focal : 0;
    entityStart('ELLIPSE', curve, 'AcDbEllipse');
    xy(10, c);
    xy(11, { x: a * ux, y: a * uy });
    tag(210, '0');
    tag(220, '0');
    tag(230, '1');
    tag(40, formatExportNumber(entity.radius / a));
    tag(41, '0');
    tag(42, formatExportNumber(2 * Math.PI));
  }
  function writeCurve(curve: SketchExportCurve) {
    const { entity } = curve;
    if (entity.type === 'line') {
      entityStart('LINE', curve, 'AcDbLine');
      xy(10, points.get(entity.startId)!);
      xy(11, points.get(entity.endId)!);
      return;
    }
    if (entity.type === 'circle' || entity.type === 'arc') {
      entityStart(entity.type === 'circle' ? 'CIRCLE' : 'ARC', curve, 'AcDbCircle');
      xy(10, points.get(entity.centerId)!);
      tag(40, length(entity.radius));
      if (entity.type === 'arc') {
        tag(100, 'AcDbArc');
        const degrees = (angle: number) => formatExportNumber(((((angle * 180) / Math.PI) % 360) + 360) % 360);
        tag(50, degrees(entity.startAngle));
        tag(51, degrees(entity.endAngle));
      }
      return;
    }
    if (!isNurbsCurve(entity)) return;
    if (options.splinesAsPolylines) return polyline(curve, tessellateCurve(entity, points, options.tolerance ?? 0.01));
    if (entity.type === 'ellipse') return ellipse(curve, entity);
    const data = clampedCurveData(rationalCurveData(entity, points));
    const rational = data.weights.some(w => Math.abs(w - 1) > 1e-12);
    const closed = entity.type === 'spline' && !!entity.closed;
    entityStart('SPLINE', curve, 'AcDbSpline');
    tag(210, '0');
    tag(220, '0');
    tag(230, '1');
    // 8 planar, 4 rational, 1 closed. The knots are clamped, so it's never flagged periodic.
    tag(70, 8 | (rational ? 4 : 0) | (closed ? 1 : 0));
    tag(71, data.degree);
    tag(72, data.knots.length);
    tag(73, data.poles.length);
    tag(74, 0);
    tag(42, '0.0000001');
    tag(43, '0.0000001');
    for (const knot of data.knots) tag(40, formatExportNumber(knot));
    if (rational) for (const weight of data.weights) tag(41, formatExportNumber(weight));
    for (const pole of data.poles) xy(10, pole);
  }

  // HEADER
  tag(0, 'SECTION');
  tag(2, 'HEADER');
  tag(9, '$ACADVER');
  tag(1, 'AC1015');
  tag(9, '$HANDSEED');
  tag(5, 'FFFFF');
  tag(9, '$INSUNITS');
  tag(70, insUnits[unit]);
  tag(9, '$MEASUREMENT');
  tag(70, unit === 'in' || unit === 'ft' ? 0 : 1);
  tag(0, 'ENDSEC');
  tag(0, 'SECTION');
  tag(2, 'CLASSES');
  tag(0, 'ENDSEC');

  // TABLES
  tag(0, 'SECTION');
  tag(2, 'TABLES');
  const table = (name: string, own: string, count: number, entries: () => void, subclass?: string) => {
    tag(0, 'TABLE');
    tag(2, name);
    tag(5, own);
    tag(330, '0');
    tag(100, 'AcDbSymbolTable');
    tag(70, count);
    if (subclass) tag(100, subclass);
    entries();
    tag(0, 'ENDTAB');
  };
  const record = (type: string, own: string, owner: string, subclass: string, name: string) => {
    tag(0, type);
    tag(5, own);
    tag(330, owner);
    tag(100, 'AcDbSymbolTableRecord');
    tag(100, subclass);
    tag(2, name);
    tag(70, 0);
  };
  table('VPORT', h.vportTable, 1, () => {
    record('VPORT', h.vport, h.vportTable, 'AcDbViewportTableRecord', '*Active');
    tag(10, '0');
    tag(20, '0');
    tag(11, '1');
    tag(21, '1');
    tag(12, '0');
    tag(22, '0');
    tag(40, '1000');
    tag(41, '1');
  });
  const dash = 5 / cadLengthUnitMm[unit];
  table('LTYPE', h.ltypeTable, 4, () => {
    for (const [own, name] of [
      [h.byBlock, 'ByBlock'],
      [h.byLayer, 'ByLayer'],
      [h.continuous, 'Continuous'],
    ] as const) {
      record('LTYPE', own, h.ltypeTable, 'AcDbLinetypeTableRecord', name);
      tag(3, name === 'Continuous' ? 'Solid line' : '');
      tag(72, 65);
      tag(73, 0);
      tag(40, '0');
    }
    record('LTYPE', h.dashed, h.ltypeTable, 'AcDbLinetypeTableRecord', 'DASHED');
    tag(3, 'Dashed __ __ __');
    tag(72, 65);
    tag(73, 2);
    tag(40, formatExportNumber(2 * dash));
    tag(49, formatExportNumber(dash));
    tag(74, 0);
    tag(49, formatExportNumber(-dash));
    tag(74, 0);
  });
  table('LAYER', h.layerTable, 3, () => {
    for (const [own, name, color, linetype] of [
      [h.layer0, '0', 7, 'Continuous'],
      [h.sketchLayer, SKETCH_LAYER, 7, 'Continuous'],
      [h.constructionLayer, CONSTRUCTION_LAYER, 8, 'DASHED'],
    ] as const) {
      record('LAYER', own, h.layerTable, 'AcDbLayerTableRecord', name);
      tag(62, color);
      tag(6, linetype);
    }
  });
  table('STYLE', h.styleTable, 1, () => {
    record('STYLE', h.style, h.styleTable, 'AcDbTextStyleTableRecord', 'Standard');
    tag(40, '0');
    tag(41, '1');
    tag(50, '0');
    tag(71, 0);
    tag(42, '2.5');
    tag(3, 'txt');
    tag(4, '');
  });
  table('VIEW', h.viewTable, 0, () => {});
  table('UCS', h.ucsTable, 0, () => {});
  table('APPID', h.appidTable, 1, () => record('APPID', h.appid, h.appidTable, 'AcDbRegAppTableRecord', 'ACAD'));
  table(
    'DIMSTYLE',
    h.dimstyleTable,
    1,
    () => {
      tag(0, 'DIMSTYLE');
      tag(105, h.dimstyle);
      tag(330, h.dimstyleTable);
      tag(100, 'AcDbSymbolTableRecord');
      tag(100, 'AcDbDimStyleTableRecord');
      tag(2, 'Standard');
      tag(70, 0);
    },
    'AcDbDimStyleTable'
  );
  table('BLOCK_RECORD', h.blockRecordTable, 2, () => {
    for (const [own, name] of [
      [h.modelRecord, '*Model_Space'],
      [h.paperRecord, '*Paper_Space'],
    ] as const) {
      tag(0, 'BLOCK_RECORD');
      tag(5, own);
      tag(330, h.blockRecordTable);
      tag(100, 'AcDbSymbolTableRecord');
      tag(100, 'AcDbBlockTableRecord');
      tag(2, name);
    }
  });
  tag(0, 'ENDSEC');

  // BLOCKS
  tag(0, 'SECTION');
  tag(2, 'BLOCKS');
  for (const [begin, end, owner, name] of [
    [h.modelBlock, h.modelBlockEnd, h.modelRecord, '*Model_Space'],
    [h.paperBlock, h.paperBlockEnd, h.paperRecord, '*Paper_Space'],
  ] as const) {
    tag(0, 'BLOCK');
    tag(5, begin);
    tag(330, owner);
    tag(100, 'AcDbEntity');
    tag(8, '0');
    tag(100, 'AcDbBlockBegin');
    tag(2, name);
    tag(70, 0);
    tag(10, '0');
    tag(20, '0');
    tag(30, '0');
    tag(3, name);
    tag(1, '');
    tag(0, 'ENDBLK');
    tag(5, end);
    tag(330, owner);
    tag(100, 'AcDbEntity');
    tag(8, '0');
    tag(100, 'AcDbBlockEnd');
  }
  tag(0, 'ENDSEC');

  tag(0, 'SECTION');
  tag(2, 'ENTITIES');
  out.push(...entities);
  tag(0, 'ENDSEC');

  // OBJECTS: the root dictionary every reader looks up.
  tag(0, 'SECTION');
  tag(2, 'OBJECTS');
  tag(0, 'DICTIONARY');
  tag(5, h.rootDictionary);
  tag(330, '0');
  tag(100, 'AcDbDictionary');
  tag(281, 1);
  tag(3, 'ACAD_GROUP');
  tag(350, h.groupDictionary);
  tag(0, 'DICTIONARY');
  tag(5, h.groupDictionary);
  tag(330, h.rootDictionary);
  tag(100, 'AcDbDictionary');
  tag(281, 1);
  tag(0, 'ENDSEC');
  tag(0, 'EOF');

  // $HANDSEED must be above every handle used.
  const seed = out.indexOf('FFFFF');
  out[seed] = nextHandle.toString(16).toUpperCase();
  return out.join('\n') + '\n';
}
