import type { Vec3 } from '../geom';
import type { Brep } from './brep';

export type StepLengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
/** A named part: its solids, each with the column-major 4x4 matrix that places it (rigid, in mm). */
export interface StepProduct {
  name: string;
  solids: { brep: Brep; matrix?: readonly number[] }[];
}
export interface StepOptions {
  /** The file's length unit; geometry is converted from mm. */
  unit?: StepLengthUnit;
  fileName?: string;
  /** ISO 8601 time for the header; fixed in tests so output is reproducible. */
  timestamp?: string;
}

const mmPer: Record<StepLengthUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
const text = (value: string) =>
  `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/[^\x20-\x7e]/g, ch => `\\X2\\${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}\\X0\\`)}'`;
const real = (value: number) => {
  const fixed = Math.abs(value) < 1e-12 ? 0 : value;
  const s = fixed.toPrecision(15).replace(/(\.\d*?)0+(e|$)/, '$1$2');
  return /[.e]/.test(s) ? s.replace(/\.(e|$)/, '.$1').toUpperCase() : `${s}.`;
};

/**
 * AP214 (automotive_design) STEP of named parts as closed B-rep solids, readable by every CAD and CAM program. Each
 * part is its own product with one shape holding its solids, placed where the matrices put them.
 */
export function writeStep(products: readonly StepProduct[], options: StepOptions = {}): string {
  const unit = options.unit ?? 'mm',
    scale = 1 / mmPer[unit];
  const lines: string[] = [];
  let next = 1;
  const add = (entity: string) => {
    lines.push(`#${next}=${entity};`);
    return `#${next++}`;
  };

  const application = add("APPLICATION_CONTEXT('automotive_design')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${application})`);
  const productContext = add(`PRODUCT_CONTEXT('',${application},'mechanical')`);
  const definitionContext = add(`PRODUCT_DEFINITION_CONTEXT('part definition',${application},'design')`);
  const lengthUnit =
    unit === 'in' || unit === 'ft'
      ? add(
          `(CONVERSION_BASED_UNIT('${unit === 'in' ? 'INCH' : 'FOOT'}',${add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${real(mmPer[unit])}),${add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))')})`)})LENGTH_UNIT()NAMED_UNIT(${add('DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)')}))`
        )
      : add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(${unit === 'mm' ? '.MILLI.' : unit === 'cm' ? '.CENTI.' : '$'},.METRE.))`);
  const angleUnit = add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
  const solidAngleUnit = add('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
  const uncertainty = add(
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${real(0.01 * scale)}),${lengthUnit},'distance_accuracy_value','')`
  );
  const geometryContext = add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${lengthUnit},${angleUnit},${solidAngleUnit}))REPRESENTATION_CONTEXT('',''))`
  );

  for (const product of products) {
    const solids = product.solids.map(({ brep, matrix }, index) =>
      solid(brep, matrix, product.solids.length > 1 ? `${product.name} ${index + 1}` : product.name)
    );
    const origin = add(`AXIS2_PLACEMENT_3D('',${point([0, 0, 0])},${direction([0, 0, 1])},${direction([1, 0, 0])})`);
    const representation = add(
      `ADVANCED_BREP_SHAPE_REPRESENTATION(${text(product.name)},(${[...solids, origin].join(',')}),${geometryContext})`
    );
    const item = add(`PRODUCT(${text(product.name)},${text(product.name)},'',(${productContext}))`);
    add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${item}))`);
    const formation = add(`PRODUCT_DEFINITION_FORMATION('','',${item})`);
    const definition = add(`PRODUCT_DEFINITION('design','',${formation},${definitionContext})`);
    const shape = add(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
    add(`SHAPE_DEFINITION_REPRESENTATION(${shape},${representation})`);
  }

  function point(p: Vec3) {
    return add(`CARTESIAN_POINT('',(${p.map(v => real(v * scale)).join(',')}))`);
  }
  function direction(d: Vec3) {
    const length = Math.hypot(...d);
    return add(`DIRECTION('',(${d.map(v => real(v / length)).join(',')}))`);
  }
  function solid(brep: Brep, matrix: readonly number[] | undefined, name: string) {
    const m = matrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const at = (p: Vec3): Vec3 => [0, 1, 2].map(r => m[r]! * p[0] + m[4 + r]! * p[1] + m[8 + r]! * p[2] + m[12 + r]!) as Vec3;
    const turn = (d: Vec3): Vec3 => [0, 1, 2].map(r => m[r]! * d[0] + m[4 + r]! * d[1] + m[8 + r]! * d[2]) as Vec3;
    const up = turn([0, 0, 1]),
      across = turn([1, 0, 0]);
    const placement = (origin: Vec3, axis: Vec3, ref: Vec3) =>
      add(`AXIS2_PLACEMENT_3D('',${point(origin)},${direction(axis)},${direction(ref)})`);
    const vertices = brep.points.map(p => add(`VERTEX_POINT('',${point(at(p))})`));
    const edges = brep.edges.map(edge => {
      const a = brep.points[edge.start]!,
        b = brep.points[edge.end]!;
      let curve: string;
      if (edge.circle) {
        const { x, y, r, z, ccw } = edge.circle;
        // The circle runs counterclockwise about the part's up axis; an edge running the other way says so.
        curve = add(`CIRCLE('',${placement(at([x, y, z]), up, across)},${real(r * scale)})`);
        return add(`EDGE_CURVE('',${vertices[edge.start]},${vertices[edge.end]},${curve},${ccw ? '.T.' : '.F.'})`);
      }
      const from = at(a),
        span = turn([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      curve = add(`LINE('',${point(from)},${add(`VECTOR('',${direction(span)},${real(Math.hypot(...span) * scale)})`)})`);
      return add(`EDGE_CURVE('',${vertices[edge.start]},${vertices[edge.end]},${curve},.T.)`);
    });
    const faces = brep.faces.map(face => {
      const bounds = face.loops.map(loop => {
        const oriented = loop.map(({ edge, forward }) => add(`ORIENTED_EDGE('',*,*,${edges[edge]},${forward ? '.T.' : '.F.'})`));
        return add(`FACE_BOUND('',${add(`EDGE_LOOP('',(${oriented.join(',')}))`)},.T.)`);
      });
      const { surface } = face;
      if (surface.kind === 'plane') {
        const normal = turn(surface.normal);
        // Any direction in the plane will do as its reference.
        const ref = Math.abs(surface.normal[2]) > 0.5 ? across : up;
        const plane = add(`PLANE('',${placement(at(surface.origin), normal, ref)})`);
        return add(`ADVANCED_FACE('',(${bounds.join(',')}),${plane},.T.)`);
      }
      const { x, y, r } = surface.circle;
      const cylinder = add(`CYLINDRICAL_SURFACE('',${placement(at([x, y, 0]), up, across)},${real(r * scale)})`);
      return add(`ADVANCED_FACE('',(${bounds.join(',')}),${cylinder},${surface.outward ? '.T.' : '.F.'})`);
    });
    return add(`MANIFOLD_SOLID_BREP(${text(name)},${add(`CLOSED_SHELL('',(${faces.join(',')}))`)})`);
  }

  const name = options.fileName ?? 'export.step',
    time = options.timestamp ?? new Date().toISOString().replace(/\.\d+Z$/, '');
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('camNC Part Studio export'),'2;1');",
    `FILE_NAME(${text(name)},${text(time)},(''),(''),'camNC','camNC','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}
