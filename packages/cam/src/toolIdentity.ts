import type { Tool } from './toolpaths';

/** Cutting data and editable labels do not identify the mounted cutter. */
export function toolIdentityKey(tool: Tool): string {
  const key: unknown[] = [
    tool.guid ?? null,
    tool.number,
    tool.diameter,
    tool.fluteLength ?? null,
    tool.flutes ?? null,
    tool.stickout ?? null,
  ];
  // Appended only for V-bits, so a flat bit keeps the key that saved runs recorded.
  if (tool.shape === 'v') key.push('v', tool.angle ?? null, tool.tipDiameter ?? 0);
  return JSON.stringify(key);
}

export const samePhysicalTool = (a: Tool, b: Tool): boolean => toolIdentityKey(a) === toolIdentityKey(b);

/** One program has one mounted cutter and one spindle speed. */
export function toolProgramKey(tool: Tool, fallbackRpm?: number): string {
  return JSON.stringify([toolIdentityKey(tool), tool.rpm ?? fallbackRpm ?? null]);
}
