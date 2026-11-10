const boundary = '\n\nOpen design context (data):\n';
const cache = { type: 'ephemeral' };

/** Cache stable instructions separately from the changing design and compacted conversation. */
export function anthropicCachedSystem(system: string) {
  const split = system.indexOf(boundary);
  const blocks = split > 0 ? [system.slice(0, split), system.slice(split)] : [system];
  return blocks.filter(Boolean).map(text => ({ type: 'text', text, cache_control: cache }));
}
