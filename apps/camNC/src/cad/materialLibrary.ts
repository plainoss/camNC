import { evaluateCadFeatures, evaluateCadPart, type CadPart, type CadPartMaterial } from '@wbcnc/cad';

export interface LibraryMaterial extends CadPartMaterial {
  category: 'Metal' | 'Plastic' | 'Wood';
}

/** The materials a part can be assigned, with their densities in kg/m³, in the order the list shows them. */
export const kMaterialLibrary: LibraryMaterial[] = [
  { name: '300 Series Stainless Steel', density: 7850, category: 'Metal' },
  { name: '400 Series Stainless Steel', density: 7720, category: 'Metal' },
  { name: 'A2 Stainless Steel', density: 8030, category: 'Metal' },
  { name: 'A4 Stainless Steel', density: 8000, category: 'Metal' },
  { name: 'ABS', density: 1050, category: 'Plastic' },
  { name: 'Acrylic', density: 1190, category: 'Plastic' },
  { name: 'Aluminum 6061', density: 2700, category: 'Metal' },
  { name: 'Ash, White', density: 670, category: 'Wood' },
  { name: 'Beech', density: 720, category: 'Wood' },
  { name: 'Birch, Yellow', density: 690, category: 'Wood' },
  { name: 'Brass', density: 8500, category: 'Metal' },
  { name: 'Cherry, Black', density: 560, category: 'Wood' },
  { name: 'Copper', density: 8930, category: 'Metal' },
  { name: 'Douglas Fir', density: 530, category: 'Wood' },
  { name: 'Mahogany', density: 600, category: 'Wood' },
  { name: 'Maple, Hard', density: 705, category: 'Wood' },
  { name: 'Maple, Soft', density: 610, category: 'Wood' },
  { name: 'Oak, Red', density: 770, category: 'Wood' },
  { name: 'Oak, White', density: 770, category: 'Wood' },
  { name: 'Pine, White', density: 400, category: 'Wood' },
  { name: 'PLA', density: 1240, category: 'Plastic' },
  { name: 'Poplar, Yellow', density: 455, category: 'Wood' },
  { name: 'Spruce', density: 450, category: 'Wood' },
  { name: 'Steel', density: 7850, category: 'Metal' },
  { name: 'Teak', density: 650, category: 'Wood' },
  { name: 'Walnut, Black', density: 610, category: 'Wood' },
];

/** A density as the list writes it: "7.700e+2". */
export const densityText = (density: number) =>
  density.toExponential(3).replace(/e\+?(-?)(\d)$/, (_, sign, digit) => `e${sign || '+'}${digit}`);

/** The library's materials whose name or category holds `query`, ignoring case. */
export function findMaterials(query: string): LibraryMaterial[] {
  const words = query.trim().toLowerCase();
  if (!words) return kMaterialLibrary;
  return kMaterialLibrary.filter(material => `${material.name} ${material.category}`.toLowerCase().includes(words));
}

const area = (points: { x: number; y: number }[]) =>
  Math.abs(points.reduce((sum, a, i) => sum + a.x * points[(i + 1) % points.length]!.y - points[(i + 1) % points.length]!.x * a.y, 0)) / 2;

/** A part's mass in kg from its material: its face, less its through holes, times its thickness. Pockets aren't taken off. */
export function partMass(part: CadPart): number | null {
  const profile = evaluateCadPart(part).part;
  if (!profile || !part.material) return null;
  const face = evaluateCadFeatures(part, profile).part;
  const mm2 = area(face.outline) - face.holes.reduce((sum, hole) => sum + area(hole), 0);
  return mm2 * part.thickness * 1e-9 * part.material.density;
}
