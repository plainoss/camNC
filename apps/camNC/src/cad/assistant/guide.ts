import reference from '../../../../../packages/cad-script/README.md?raw';

function between(start: string, end: string): string {
  const from = reference.indexOf(start);
  const to = reference.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Assistant guide section is missing: ${start}`);
  return reference.slice(from, to).trim();
}

/** Detailed help comes from the same API reference as the CLI, without its setup and replay instructions. */
export const guideSections: Record<string, string> = {
  geometry: between('## Writing a script', '## Changing an open design'),
  editing: between('## Changing an open design', '### Browser checks'),
  variables: between('## Variables', '## Folder scopes and cupboards'),
  folders: between('## Folder scopes and cupboards', '## Building a piece in the studio'),
  assembly: between('## Building a piece in the studio', '## The toolpath summary'),
  reports: between('## The full report', '## Golden reports'),
};

export const assistantGuide = `CAD script quick reference (plain JavaScript; lengths in mm).
Use d => { ... } or import { design, cupboard } from '@wbcnc/cad-script'; export default design(d => { ... });
Each check starts from the original open design, not the previous checked candidate. Report handles apply only to that revision.
Edit existing identities: d.part(nameOrHandle), d.existingCopy(nameOrHandle), d.step(handleOrExactLabel).set(settings).
d.part never creates. d.newPart(name, { thickness: 18 }) explicitly creates; duplicate names fail.
d.variable('board', '18mm') adds/updates a variable. Expressions such as 'width - 2*board' stay editable; d.value(expression) evaluates one now.
Create a whole piece in d.folder('Stool', scoped => { ... }); edit with d.existingFolder(nameOrHandle, scoped => { ... }). Scoped names/expressions refer to that folder; folders cannot nest.
Geometry: const p = d.newPart('Plate', { thickness: 'board' }); p.profile.rect({ at: [0, 0], w: 400, h: 300 });
p.profile.circle({ at: [30, 30], d: 8 }) makes a profile hole. Sketch coordinates are local, Y up. Rectangles/circles are constrained.
const top = p.sketchOn('top'); top.circle({ at: [100, 80], d: 20 }); p.cut(top.regionAt(100, 80), { depth: 6 });
depth: 'through' makes a hole; through cuts cannot reach the part edge. Change the profile for open notches. Underside sketches reverse local X.
const s = d.existingCopy('Shelf 2'); const face = s.sketchOn('top'); face.circle({ at: [100, 80], d: 60 }); s.cut(face.regionAt(100, 80), { depth: 'through' }); changes only that physical copy.
p.thickness(24); p.existingCut(handle).depth(6); p.profile.fillet([p.profile.find(cornerHandle)], 12) edit existing geometry.
d.step(handle).set accepts thickness on extrudes; depth on cuts; tools/targets/clearance on cut-parts; count/spacing/axis on linear part patterns; radius on fillets; suppression where supported.
Studio axes: X left/right, Y front/back, Z up. Draw a part's profile BEFORE calling drawOn. p.drawOn('front', { offset: 0 }) places that profile on a plane ('top', 'front' or 'right'); p.drawOn(other.face('+x'), { offset: 0 }) attaches to a face.
p.pattern({ axis: 'z', count: 3, spacing: '100mm' }) returns copies excluding p; p.copy({ at, x, y, mirrored?, name? }) adds a placed copy.
d.cutParts(target, { with: [tools], clearance: 'fit' }) makes housings following intersecting rectangular tool material. A source tool includes its copies; a returned copy cuts alone.
d.cutParts(target, { with: tenon, clearance: '0.2mm', cornerRelief: { dogbone: 6 } }) puts bones for that cutter in only this step's openings; 'off' keeps them square.
d.cutParts(a, { with: b, split: 'half' }) makes a half lap; split: { fingers: 5 } makes fingers. Start with plain boards; retrieve assembly help for limits.
sketch.pattern(items, { count, step: [dx, dy], rows? }) repeats holes/curves; cutting the seed region cuts the pattern. Counts/steps can be expressions.
d.detachCopy('Shelf 2', 'Cable shelf') makes a separately editable part. Retrieve editing help before detaching mirrored/referenced copies or deleting entities.
cupboard({ name?, width?, height?, depth?, board?, shelves?, at? })(d) inserts a folder of editable parts/variables; lengths are expression strings, shelves a number, at XYZ mm. Defaults use pin rows.
p.expect({ size: [400, 300], thickness: 18, holes: 1, pockets: 1, depths: [6], freedom: 0 }) checks those facts, not hole diameters/positions.
Read report cuts, placements, diagnostics and lost-cut/joint costs; a valid check does not prove visual resemblance, joint strength or machining acceptance.
Use a relevant supplied example for curved shapes rather than searching for geometry. Keep agreed sizes checked with expect; derive coordinates from expressions when dimensions must remain editable.
Retrieve cad_script_guide with section: ${Object.keys(guideSections).join(', ')} for exact detailed options. Read a relevant worked example before complex construction. Do not invent API methods.`;

export function readAssistantGuide(section?: string): string {
  if (!section) return assistantGuide;
  return Object.hasOwn(guideSections, section)
    ? guideSections[section]!
    : `Unknown guide section. Available: ${Object.keys(guideSections).join(', ')}`;
}
