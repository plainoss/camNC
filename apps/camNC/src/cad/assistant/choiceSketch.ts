export interface AssistantChoiceShape {
  kind: 'rect' | 'ellipse' | 'line';
  coords: [number, number, number, number];
}
export interface AssistantChoiceSketch {
  choiceIndex: number;
  shapes: AssistantChoiceShape[];
}
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
/** Numeric geometry only; the renderer owns every SVG attribute and color. */
export const choiceSketchesSchema = {
  type: 'array',
  maxItems: 4,
  items: object(
    {
      choiceIndex: { type: 'integer', minimum: 0, maximum: 3, description: 'Zero-based index into choices.' },
      shapes: {
        type: 'array',
        minItems: 1,
        maxItems: 12,
        items: object(
          {
            kind: { type: 'string', enum: ['rect', 'ellipse', 'line'] },
            coords: {
              type: 'array',
              minItems: 4,
              maxItems: 4,
              items: { type: 'number', minimum: 0, maximum: 100 },
              description:
                'Four numbers in 0..100: rect [x,y,width,height], ellipse [centerX,centerY,radiusX,radiusY], line [x1,y1,x2,y2]. Shapes must fit the 100 by 100 canvas.',
            },
          },
          ['kind', 'coords']
        ),
      },
    },
    ['choiceIndex', 'shapes']
  ),
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readShape(value: unknown): AssistantChoiceShape | undefined {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'kind' && key !== 'coords')) return;
  const { kind, coords } = value;
  if (kind !== 'rect' && kind !== 'ellipse' && kind !== 'line') return;
  if (
    !Array.isArray(coords) ||
    coords.length !== 4 ||
    coords.some(coord => typeof coord !== 'number' || !Number.isFinite(coord) || coord < 0 || coord > 100)
  )
    return;
  const [a, b, c, d] = coords as [number, number, number, number];
  if (kind === 'rect' && (c <= 0 || d <= 0 || a + c > 100 || b + d > 100)) return;
  if (kind === 'ellipse' && (c <= 0 || d <= 0 || a - c < 0 || a + c > 100 || b - d < 0 || b + d > 100)) return;
  if (kind === 'line' && a === c && b === d) return;
  return { kind, coords: [a, b, c, d] };
}
/** Ignore invalid sketches independently; ignore every entry for duplicate indices to avoid ambiguous illustrations. */
export function readChoiceSketches(value: unknown, choiceCount: number): AssistantChoiceSketch[] {
  if (!Number.isInteger(choiceCount) || choiceCount < 1 || choiceCount > 4 || !Array.isArray(value) || value.length > 4) return [];
  const counts = new Map<number, number>();
  for (const entry of value)
    if (isRecord(entry) && typeof entry.choiceIndex === 'number') counts.set(entry.choiceIndex, (counts.get(entry.choiceIndex) ?? 0) + 1);
  const sketches: AssistantChoiceSketch[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || Object.keys(entry).some(key => key !== 'choiceIndex' && key !== 'shapes')) continue;
    const { choiceIndex, shapes } = entry;
    if (
      typeof choiceIndex !== 'number' ||
      !Number.isInteger(choiceIndex) ||
      choiceIndex < 0 ||
      choiceIndex >= choiceCount ||
      counts.get(choiceIndex) !== 1
    )
      continue;
    if (!Array.isArray(shapes) || shapes.length < 1 || shapes.length > 12) continue;
    const parsed = shapes.map(readShape);
    if (parsed.some(shape => !shape)) continue;
    sketches.push({ choiceIndex, shapes: parsed as AssistantChoiceShape[] });
  }
  return sketches;
}
