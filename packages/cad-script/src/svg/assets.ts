import { parseSvgSketch } from './parse';
import { SVG_LIMITS, type SvgSketchAsset } from './types';
export interface SvgAssetSummary {
  handle: string;
  name: string;
  units: 'mm';
  bounds: SvgSketchAsset['bounds'];
  contours: number;
  curves: number;
  warnings: string[];
}
/** Session-local geometry assets. The assistant receives summaries and handles; it never
 * needs to echo the original XML or repeat large control polygons on repair turns.
 */
export function createSvgAssetStore() {
  let next = 1;
  const entries = new Map<string, { source: string; name: string; asset: SvgSketchAsset }>();
  const getEntry = (handle: string) => {
    const entry = entries.get(handle);
    if (!entry) throw new Error('Unknown SVG asset handle. Import the SVG in this conversation first.');
    return entry;
  };
  const summary = (handle: string): SvgAssetSummary => {
    const entry = getEntry(handle);
    return structuredClone({
      handle,
      name: entry.name,
      units: 'mm',
      bounds: entry.asset.bounds,
      contours: entry.asset.contours.length,
      curves: entry.asset.contours.reduce((n, c) => n + c.segments.length, 0),
      warnings: entry.asset.warnings,
    });
  };
  return {
    register(source: string, name = 'Imported SVG'): SvgAssetSummary {
      for (const [handle, entry] of entries) if (entry.source === source) return summary(handle);
      if (entries.size >= SVG_LIMITS.assets) throw new Error('SVG asset limit reached. Remove an asset or start a new conversation.');
      const asset = parseSvgSketch(source),
        handle = `svg-${next++}`;
      entries.set(handle, { source, name: name.slice(0, 200), asset });
      return summary(handle);
    },
    get(handle: string): SvgSketchAsset {
      return structuredClone(getEntry(handle).asset);
    },
    summary,
    list(): SvgAssetSummary[] {
      return [...entries.keys()].map(summary);
    },
    remove(handle: string): boolean {
      return entries.delete(handle);
    },
    clear(): void {
      entries.clear();
    },
  };
}
export type SvgAssetStore = ReturnType<typeof createSvgAssetStore>;
