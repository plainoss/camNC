import assert from 'node:assert/strict';

/** Estimates affect scheduling only; every item is assigned exactly once, including unseen items. */
export function balancedShards(items, count, id, weight) {
  assert(Number.isSafeInteger(count) && count > 0 && count <= 10000, 'Invalid shard count');
  assert(new Set(items.map(id)).size === items.length, 'Duplicate shard item identity');
  const bins = Array.from({ length: count }, () => ({ weight: 0, items: [] }));
  const estimate = item => { const value = weight(item); return Number.isFinite(value) && value > 0 ? value : 1; };
  const ordered = [...items].sort((a, b) => estimate(b) - estimate(a) || id(a).localeCompare(id(b), 'en'));
  for (const item of ordered) {
    const bin = bins.reduce((best, next) => next.weight < best.weight ? next : best);
    bin.items.push(item);
    bin.weight += estimate(item);
  }
  return bins.map(bin => bin.items);
}
