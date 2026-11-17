import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// These are evidence, not repaired candidates. Keep the exact supplied bytes so
// later joint regressions cannot silently replace a difficult original input.
describe('issue 585 original furniture inputs', () => {
  it.each([
    ['panel-chair', '30f1c46bad7a27455d94d3231acbdc3ba5ccca803dc5909495a02f0764f55ff6'],
    ['frame-stool', 'd1c1d7430293051728ce842ce3051cc1b15e677b5599786630c44cea3a528184'],
  ])('preserves the supplied %s bytes', async (name, hash) => {
    const file = new URL(`../fixtures/designs/furniture-original-${name}.json`, import.meta.url);
    expect(
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
    ).toBe(hash);
  });
});
