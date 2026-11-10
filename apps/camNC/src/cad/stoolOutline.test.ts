import { readFileSync } from 'node:fs';
import { parseCadDocument, solveCadDocument } from '@wbcnc/cad';
import { BufferAttribute, BufferGeometry, EdgesGeometry } from 'three';
import { expect, it } from 'vitest';
import { assemblyModel } from './assemblyModel';

it('keeps the complete stool seat free of outline seams between opposite-face joint floors', async () => {
  const document = parseCadDocument(
    JSON.parse(
      readFileSync(new URL('../../../../packages/cad-script/fixtures/designs/stool-two-sided-joints.json', import.meta.url), 'utf8')
    )
  );
  const solved = await solveCadDocument(document);
  expect(solved.status).toBe('solved');
  // Reload the complete design so the panel housings and back-post mortises both reach the display mesher.
  const model = assemblyModel(parseCadDocument(JSON.parse(JSON.stringify(solved.document))));
  expect(model.problems).toEqual([]);
  expect(model.instances).toHaveLength(10);
  const seat = model.meshes.find(mesh => mesh.name === 'Large seat')!;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(seat.positions, 3));
  geometry.setIndex(new BufferAttribute(seat.indices, 1));
  const edges = new EdgesGeometry(geometry, 20),
    lines = edges.getAttribute('position');
  const frontEdges = [];
  for (let i = 0; i < lines.count; i += 2)
    if (lines.getY(i) < 1 && lines.getY(i + 1) < 1 && lines.getZ(i) === lines.getZ(i + 1)) frontEdges.push(lines.getZ(i));
  // The seat is 18mm stock at world z432: only its top and bottom rims cross the uninterrupted front edge.
  expect([...new Set(frontEdges)].sort((a, b) => a - b)).toEqual([432, 450]);
  edges.dispose();
  geometry.dispose();
});
