import { useSyncExternalStore } from 'react';
import { featureUses, type CadDocument, type DesignStep } from '@wbcnc/cad';

/** The filter syntax, as the box's help lists it. A bare word filters by name or type. */
export const kFeatureFilterHelp: [string, string][] = [
  [':part name', 'Features of parts by name'],
  [':type name', 'Features by type, such as Extrude'],
  [':name name', 'Features by name'],
  [':errors name', 'Features with errors'],
  [':warnings name', 'Features with warnings'],
  [':folder name', 'Features in folders by name'],
  [':variable name', 'Variables by name (case sensitive), and the features that use them'],
  [':suppressed name', 'Suppressed features'],
  [':hidden name', 'Hidden features'],
  [':shown name', 'Shown features'],
];

const kKeywords = new Set(['part', 'type', 'name', 'errors', 'warnings', 'folder', 'variable', 'suppressed', 'hidden', 'shown']);

/** A typed filter: its keyword, if it starts with one, and the words after it. */
export function parseFeatureFilter(text: string): { keyword: string | null; term: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = /^:(\w+)\s*(.*)$/.exec(trimmed);
  if (match && kKeywords.has(match[1]!.toLowerCase())) return { keyword: match[1]!.toLowerCase(), term: match[2]!.trim() };
  return { keyword: null, term: trimmed };
}

/** One feature list row, as the filter reads it. */
export interface FilterRow {
  key: string;
  kind: 'step' | 'variable' | 'plane' | 'folder';
  label: string;
  step?: DesignStep;
  /** The variable's own name, without its `#`. */
  variable?: string;
  folder?: string;
  shown?: boolean;
}

const kStepTypes: Record<DesignStep['kind'], string> = {
  sketch: 'Sketch',
  extrude: 'Extrude',
  move: 'Transform',
  faceSketch: 'Sketch',
  cut: 'Extrude',
  fillet: 'Fillet',
  mirror: 'Mirror',
  copy: 'Transform',
  pattern: 'Linear pattern',
  partCut: 'Cut parts',
  split: 'Split',
};

const typeOf = (row: FilterRow) =>
  row.kind === 'step' ? kStepTypes[row.step!.kind] : row.kind === 'variable' ? 'Variable' : row.kind === 'plane' ? 'Plane' : 'Folder';

/**
 * The rows the filter keeps, by key; null when nothing is typed or the filter keeps everything, as a keyword alone does
 * for `:variable`.
 */
export function filteredFeatureRows(document: CadDocument, rows: FilterRow[], text: string): Set<string> | null {
  const query = parseFeatureFilter(text);
  if (!query) return null;
  const { keyword, term } = query;
  const has = (value: string | undefined) => !term || !!value?.toLowerCase().includes(term.toLowerCase());
  if (keyword === 'variable') {
    if (!term) return null;
    // Case sensitive, as the reference: the variables named so, and what uses them.
    const named = new Set(rows.filter(row => row.kind === 'variable' && row.variable?.includes(term)).map(row => row.key));
    const uses = featureUses(document);
    return new Set([...named, ...rows.filter(row => [...(uses.get(row.key) ?? [])].some(used => named.has(used))).map(row => row.key)]);
  }
  const partName = (row: FilterRow) => document.parts.find(part => part.id === row.step?.partId)?.name;
  const keep = rows.filter(row => {
    if (row.kind === 'folder') return keyword === 'folder' && has(row.label);
    switch (keyword) {
      case null:
        return has(row.label) || has(typeOf(row));
      case 'part':
        return row.kind === 'step' && has(partName(row));
      case 'type':
        return has(typeOf(row));
      case 'name':
        return has(row.label);
      case 'errors':
        return !!row.step?.broken && has(row.label);
      case 'warnings':
        return false;
      case 'folder':
        return !!row.folder && has(row.folder);
      case 'suppressed':
        return !!row.step?.suppressed && has(row.label);
      case 'hidden':
        return row.shown === false && has(row.label);
      case 'shown':
        return row.shown === true && has(row.label);
      default:
        return false;
    }
  });
  return new Set(keep.map(row => row.key));
}

/** Whether a part's row in the Parts list stays under the filter: only by its own name, or as a part. */
export function partMatchesFilter(name: string, text: string): boolean {
  const query = parseFeatureFilter(text);
  if (!query || (query.keyword === 'variable' && !query.term)) return true;
  const has = (value: string) => value.toLowerCase().includes(query.term.toLowerCase());
  if (query.keyword === null) return has(name) || has('Part');
  return (query.keyword === 'part' || query.keyword === 'name') && has(name);
}

/** The filter typed above the Feature list, which the Parts list follows too. */
let current = '';
const listeners = new Set<() => void>();
export function setFeatureFilter(next: string) {
  if (next === current) return;
  current = next;
  listeners.forEach(listener => listener());
}
export const subscribeFeatureFilter = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const featureFilterNow = () => current;

/** The filter typed above the Feature list, shared with the Parts list. */
export const useFeatureFilter = () => useSyncExternalStore(subscribeFeatureFilter, featureFilterNow);
