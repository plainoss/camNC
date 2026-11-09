/**
 * Whether a JSON value nests objects or arrays more than `limit` deep. Iterative, so it can't overflow the stack on the
 * input it exists to refuse (a deeper value would overflow `structuredClone` while loading).
 */
export function nestedDeeperThan(value: unknown, limit: number): boolean {
  const pending: [unknown, number][] = [[value, 0]];
  while (pending.length) {
    const [current, depth] = pending.pop()!;
    if (!current || typeof current !== 'object') continue;
    if (depth >= limit) return true;
    for (const child of Object.values(current)) if (child && typeof child === 'object') pending.push([child, depth + 1]);
  }
  return false;
}
