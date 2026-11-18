import { expect, it } from 'vitest';
import { studioSearchCommands } from './studioSearchCommands';

it('lists the other plane commands under Plane, greyed until they’re available', () => {
  const planes = studioSearchCommands({}).filter(command => /plane/i.test(command.label));
  expect(planes.map(command => [command.label, command.unavailable ?? null])).toEqual([
    ['Plane', null],
    ['Plane Normal To Edge', 'Not available yet'],
    ['Plane Containing Edges', 'Not available yet'],
    ['Offset Planes', 'Not available yet'],
    ['Intermediate Planes', 'Not available yet'],
    ['Surface Tangent Plane', 'Not available yet'],
  ]);
});
