import assert from 'node:assert/strict';

/**
 * Estimates affect scheduling only; every item is assigned exactly once, including unseen items.
 * `reserved[i]` starts bin i with that much load, for work a shard runs besides its items.
 */
export function balancedShards(items, count, id, weight, reserved = []) {
  assert(Number.isSafeInteger(count) && count > 0 && count <= 10000, 'Invalid shard count');
  assert(new Set(items.map(id)).size === items.length, 'Duplicate shard item identity');
  assert(reserved.length <= count && reserved.every(value => Number.isFinite(value) && value >= 0), 'Invalid shard reservation');
  const bins = Array.from({ length: count }, (_, index) => ({ weight: reserved[index] ?? 0, items: [] }));
  const estimate = item => { const value = weight(item); return Number.isFinite(value) && value > 0 ? value : 1; };
  const ordered = [...items].sort((a, b) => estimate(b) - estimate(a) || id(a).localeCompare(id(b), 'en'));
  for (const item of ordered) {
    const bin = bins.reduce((best, next) => next.weight < best.weight ? next : best);
    bin.items.push(item);
    bin.weight += estimate(item);
  }
  return bins.map(bin => bin.items);
}
