import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { routeFileIgnorePattern } from '../../vite.config';

it('excludes colocated test sources while retaining every generated application route', () => {
  const routes = fileURLToPath(new URL('../routes/', import.meta.url));
  const ignored = new RegExp(routeFileIgnorePattern);
  const testSources = readdirSync(routes, { recursive: true })
    .map(String)
    .filter(file => /\.[cm]?[jt]sx?$/.test(file))
    .filter(file => /from\s*['"](?:vitest|@testing-library\/)/.test(readFileSync(join(routes, file), 'utf8')));
  expect(testSources.length).toBeGreaterThan(0);
  for (const file of testSources) expect(ignored.test(basename(file)), file).toBe(true);

  const tree = readFileSync(new URL('../routeTree.gen.ts', import.meta.url), 'utf8');
  const included = [...tree.matchAll(/from ['"]\.\/routes\/([^'"]+)['"]/g)].map(match => `${match[1]}.tsx`);
  expect(included.length).toBeGreaterThan(0);
  for (const file of included) expect(ignored.test(basename(file)), file).toBe(false);
});
