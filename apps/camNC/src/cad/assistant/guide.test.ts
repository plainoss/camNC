import { expect, it } from 'vitest';
import { assistantGuide, guideSections, readAssistantGuide } from './guide';
import reference from '../../../../../packages/cad-script/README.md?raw';

it('keeps the default model guide small and retrieves API-specific detail from the canonical reference', () => {
  expect(assistantGuide.length).toBeLessThan(5500);
  expect(assistantGuide.length).toBeLessThan(reference.length / 3);
  expect(readAssistantGuide()).toBe(assistantGuide);
  for (const section of Object.values(guideSections)) expect(reference).toContain(section);
  expect(readAssistantGuide('geometry')).toContain("count: '(height - 2*margin)/pitch + 1'");
  expect(readAssistantGuide('editing')).toContain("d.detachCopy('Shelf 2', 'Cable shelf')");
  expect(readAssistantGuide('editing')).toContain('mirrored detach');
  expect(readAssistantGuide('assembly')).toContain('split: { fingers: 5 }');
  expect(readAssistantGuide('assembly')).toContain("cornerRelief: { dogbone: 'cutter' }");
  expect(assistantGuide).toContain('cornerRelief: { dogbone: 6 }');
  expect(readAssistantGuide('folders')).toContain('globally unique');
  expect(readAssistantGuide('unknown')).toContain('Available: geometry, editing, variables, folders, assembly, reports');
});
