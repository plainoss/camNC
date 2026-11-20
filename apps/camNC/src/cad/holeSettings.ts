import { cadHoleName, type CadPart } from '@wbcnc/cad';

export type HoleKind = 'simple' | 'counterbore' | 'countersink';
export type HoleTermination = 'blind' | 'upToNext' | 'upToEntity' | 'through';

/** A Hole dialog's settings, as typed: lengths in the design's unit, angles in degrees. */
export interface HoleSettings {
  kind: HoleKind;
  drillSize: number;
  diameter: string;
  termination: HoleTermination;
  depth: string;
  tipAngle: string;
  counterboreDiameter: string;
  counterboreDepth: string;
  countersinkDiameter: string;
  countersinkAngle: string;
}

/** Metric drill sizes, mm, as the Drill size list offers them. */
export const kDrillSizes = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20];
export const kTerminations: { id: HoleTermination; label: string; available: boolean }[] = [
  { id: 'blind', label: 'Blind', available: true },
  { id: 'upToNext', label: 'Up to next', available: false },
  { id: 'upToEntity', label: 'Up to entity', available: false },
  { id: 'through', label: 'Through all', available: true },
];

const text = (value: number) => `${+value.toFixed(3)}`;
/** A drill size's counterbore, as for a socket head screw of that clearance: 6 mm takes ⌀ 12.25 × 1. */
const counterboreFor = (size: number) => ({ diameter: text(Math.round(size * 2.0417 * 4) / 4), depth: '1' });
/** A drill size's countersink, at 90°: 6 mm takes ⌀ 10. */
const countersinkFor = (size: number) => ({ diameter: text(Math.round((size * 5) / 3)), angle: '90' });

/** The sizes that go with a drill size: its diameter, counterbore and countersink. */
export function forDrillSize(settings: HoleSettings, size: number): HoleSettings {
  const bore = counterboreFor(size),
    sink = countersinkFor(size);
  return {
    ...settings,
    drillSize: size,
    diameter: text(size),
    counterboreDiameter: bore.diameter,
    counterboreDepth: bore.depth,
    countersinkDiameter: sink.diameter,
    countersinkAngle: sink.angle,
  };
}

// The last hole made, for the next one to start from: its tab, termination and depth, as the reference remembers them.
let remembered: Pick<HoleSettings, 'kind' | 'termination' | 'depth'> = { kind: 'simple', termination: 'through', depth: '33' };

/** Where a new Hole dialog starts: a 6 mm drill, as the last hole was made otherwise. */
export function initialHoleSettings(): HoleSettings {
  return forDrillSize(
    {
      ...remembered,
      drillSize: 6,
      diameter: '6',
      tipAngle: '118',
      counterboreDiameter: '',
      counterboreDepth: '',
      countersinkDiameter: '',
      countersinkAngle: '',
    },
    6
  );
}

/** Keeps a dialog's tab, termination and depth for the next Hole. */
export function rememberHole(settings: HoleSettings) {
  remembered = { kind: settings.kind, termination: settings.termination, depth: settings.depth };
}

/** An existing Hole step's settings, as its dialog opens on them. */
export function holeSettingsOf(part: CadPart, lengthText: (value: number) => string): HoleSettings {
  const size = part.hole?.drillSize ?? 6;
  const depth = part.remove?.depth;
  return {
    ...forDrillSize(initialHoleSettings(), size),
    kind: 'simple',
    diameter: part.hole?.diameterExpression ?? lengthText(part.hole?.diameter ?? size),
    termination: typeof depth === 'number' ? 'blind' : 'through',
    depth: typeof depth === 'number' ? (part.remove?.depthExpression ?? lengthText(depth)) : remembered.depth,
    tipAngle: text(part.hole?.tipAngle ?? 118),
  };
}

/** The dialog's title, as the step will be named: ⌀ 6 mm x 5 mm, with its counterbore or countersink after a bar. */
export function holeTitle(settings: HoleSettings, diameter: number | null, depth: number | null): string {
  const name = cadHoleName({
    hole: { diameter: diameter ?? settings.drillSize },
    remove: { depth: settings.termination === 'blind' && depth !== null ? depth : 'through' },
  });
  if (settings.kind === 'counterbore')
    return `${name} | (counterbore)⌀ ${settings.counterboreDiameter} mm x ${settings.counterboreDepth} mm`;
  if (settings.kind === 'countersink') return `${name} | (countersink)⌀ ${settings.countersinkDiameter} mm x ${settings.countersinkAngle}°`;
  return name;
}

type Parse = (text: string) => { value: number; expression?: string } | { error: string };

/** What a Hole step is set to by its dialog, or why it can't be: a counterbore or countersink isn't drilled yet. */
export function holeSpecOf(settings: HoleSettings, parse: Parse): Pick<CadPart, 'hole' | 'remove'> | { error: string } {
  const across = parse(settings.diameter);
  if ('error' in across) return across;
  if (!(across.value > 0)) return { error: 'A hole needs a diameter.' };
  const tip = Number(settings.tipAngle);
  const hole: NonNullable<CadPart['hole']> = {
    diameter: across.value,
    ...(across.expression && { diameterExpression: across.expression }),
    drillSize: settings.drillSize,
    ...(Number.isFinite(tip) && tip > 0 && tip < 180 && { tipAngle: tip }),
  };
  if (settings.termination !== 'blind') return { hole, remove: { depth: 'through' } };
  const deep = parse(settings.depth);
  if ('error' in deep) return deep;
  if (!(deep.value > 0)) return { error: 'A hole needs some depth.' };
  return { hole, remove: { depth: deep.value, ...(deep.expression && { depthExpression: deep.expression }) } };
}

/** Why the green check can't make these settings: only a simple hole is drilled so far. */
export const holeKindRefusal = (settings: HoleSettings) =>
  settings.kind === 'simple' ? null : `A ${settings.kind} hole can't be made yet: choose Simple to drill a plain hole.`;
