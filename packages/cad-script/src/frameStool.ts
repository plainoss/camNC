import type { CadScript, PartEdit } from './editTypes';
import type { ScriptConstruction } from './constructionApi';
import { fail } from './editExisting';
import { placedFrom } from './furnitureOrigin';

export interface FrameStoolOptions {
  name?: string;
  /** Outside of the legs. The seat overhangs this footprint by `overhang` on every side. */
  width?: string;
  depth?: string;
  /** Seat top above the floor. */
  height?: string;
  overhang?: string;
  /** Rail and cleat stock. */
  board?: string;
  /** Each leg is two laminations of this stock, bonded after their mortises are machined. */
  legLayer?: string;
  seatBoard?: string;
  apronHeight?: string;
  footrestHeight?: string;
  footrestZ?: string;
  cutter?: string;
  fit?: string;
  measuredStock?: boolean;
  /** Assembly origin in mm, so the stool can sit beside existing work. */
  at?: readonly [number, number, number];
}

const corners = [
  ['front-left', 0, 0],
  ['front-right', 1, 0],
  ['back-left', 0, 1],
  ['back-right', 1, 1],
] as const;

/**
 * Bounded, permanent glued frame pattern: laminated legs, shouldered rail tenons and a seat screwed down through
 * tenoned cleats. Ordinary source geometry remains editable.
 */
export function frameStool(options: FrameStoolOptions = {}): CadScript {
  return root => {
    const at = placedFrom(options.at);
    const variables: Record<string, string> = {};
    const members: ScriptConstruction['members'] = [];
    const connections: ScriptConstruction['connections'] = [];
    const hardware: ScriptConstruction['hardware'] = [];
    const legRoles: string[] = [],
      railRoles: string[] = [],
      cleatRoles: string[] = [];
    const folder = root.folder(options.name ?? 'Frame stool', d => {
      for (const [name, expression] of Object.entries({
        board: options.board ?? '18mm',
        legLayer: options.legLayer ?? '40mm',
        seatBoard: options.seatBoard ?? '18mm',
        width: options.width ?? '340mm',
        depth: options.depth ?? '340mm',
        height: options.height ?? '650mm',
        overhang: options.overhang ?? '10mm',
        apronHeight: options.apronHeight ?? '70mm',
        footrestHeight: options.footrestHeight ?? '50mm',
        footrestZ: options.footrestZ ?? '250mm',
        cutter: options.cutter ?? '3.175mm',
        fit: options.fit ?? '0.1mm',
        leg: '2*legLayer',
        // A 7 mm nominal web stays between perpendicular mortises; the check measures the relieved one.
        engagement: 'legLayer - board/2 - 7mm',
        shoulder: '12mm',
        frameTop: 'height - seatBoard',
        cleatWidth: '60mm',
        cleatDrop: '10mm',
        screwLength: '40mm',
      }))
        variables[name] = d.variable(name, expression);
      const v = (expression: string) => d.value(expression);
      if (
        !(
          v('board') >= 16 &&
          v('board') <= 24 &&
          v('legLayer') >= 30 &&
          v('legLayer') <= 60 &&
          v('seatBoard') >= 15 &&
          v('seatBoard') <= 25 &&
          v('engagement') >= 20 &&
          v('legLayer - board/2 - engagement') >= 5 &&
          v('apronHeight - 2*shoulder') >= 25 &&
          v('footrestHeight - 2*shoulder') >= 20 &&
          v('min(width; depth) - 2*leg') >= 150 &&
          v('footrestZ') >= 150 &&
          v('footrestZ + footrestHeight + 80mm') <= v('frameTop - apronHeight - 40mm') &&
          v('cutter') > 0 &&
          v('cutter') < 4.5 &&
          v('fit') >= 0 &&
          v('fit') <= 0.2
        )
      )
        return fail(
          'This frame-stool pattern needs 16–24 mm rail stock, 30–60 mm leg laminations, 15–25 mm seat board, at least 20 mm tenon engagement with a 5 mm web between perpendicular mortises, 25 mm apron and 20 mm footrest tenons, 150 mm between legs, room for staggered footrests below the aprons, cutter < 4.5 mm and fit 0–0.2 mm. Change the layout or stock before completing it.'
        );
      // A layout bound for this pattern, not a tipping or load rating.
      if (v('min(width; depth)') < v('height/2'))
        return fail('The footprint is narrower than half the seat height. Widen the stance or lower the seat before offering this stool.');

      const layers: PartEdit[] = [];
      for (const [corner, i, j] of corners) {
        const roles = ['a', 'b'].map((layer, k) => {
          const p = d.newPart(`${corner} leg ${layer}`, { thickness: 'legLayer', relief: 'cutter' });
          p.profile.rect({ at: [0, 0], w: 'leg', h: 'frameTop' });
          p.place(at({ at: [`${i ? 'width - leg' : '0mm'} + ${k}*legLayer`, j ? 'depth - leg' : 0, 0], x: '+y', y: '+z' }));
          const role = `${corner}-leg-${layer}`;
          members.push({ role, member: p });
          legRoles.push(role);
          layers.push(p);
          return role;
        });
        connections.push({ id: `${corner}-leg-lamination`, kind: 'glued-lamination', roles: roles, hardwareIds: [] });
      }
      const legOf = (corner: string) => [`${corner}-leg-a`, `${corner}-leg-b`];

      // Rails sit on the legs' centre lines; their tenons are shouldered top and bottom.
      const rails: PartEdit[] = [];
      const rail = (name: string, alongX: boolean, low: string, line: string, high: string, ends: readonly [string, string]) => {
        const span = alongX ? 'width' : 'depth';
        const p = d.newPart(name, { thickness: 'board', relief: 'cutter' });
        p.profile
          .path(['leg', low])
          .lineTo([`${span} - leg`, low])
          .lineTo([`${span} - leg`, `${low} + shoulder`])
          .lineTo([`${span} - leg + engagement`, `${low} + shoulder`])
          .lineTo([`${span} - leg + engagement`, `${high} - shoulder`])
          .lineTo([`${span} - leg`, `${high} - shoulder`])
          .lineTo([`${span} - leg`, high])
          .lineTo(['leg', high])
          .lineTo(['leg', `${high} - shoulder`])
          .lineTo(['leg - engagement', `${high} - shoulder`])
          .lineTo(['leg - engagement', `${low} + shoulder`])
          .lineTo(['leg', `${low} + shoulder`])
          .close({ straight: true });
        p.place(at(alongX ? { at: [0, `${line} + board/2`, 0], x: '+x', y: '+z' } : { at: [`${line} - board/2`, 0, 0], x: '+y', y: '+z' }));
        const role = name.toLowerCase().replaceAll(' ', '-');
        members.push({ role, member: p });
        railRoles.push(role);
        rails.push(p);
        for (const end of ends)
          connections.push({ id: `${role}-${end}`, kind: 'glued-shouldered-tenon', roles: [...legOf(end), role], hardwareIds: [] });
        return p;
      };
      const apronLow = 'frameTop - apronHeight';
      const sideFootrestZ = 'footrestZ + footrestHeight + 30mm';
      rail('Front apron', true, apronLow, 'legLayer', 'frameTop', ['front-left', 'front-right']);
      rail('Back apron', true, apronLow, 'depth - legLayer', 'frameTop', ['back-left', 'back-right']);
      const sideAprons = [
        rail('Left apron', false, apronLow, 'legLayer', 'frameTop', ['front-left', 'back-left']),
        rail('Right apron', false, apronLow, 'width - legLayer', 'frameTop', ['front-right', 'back-right']),
      ];
      rail('Front footrest', true, 'footrestZ', 'legLayer', 'footrestZ + footrestHeight', ['front-left', 'front-right']);
      rail('Back footrest', true, 'footrestZ', 'depth - legLayer', 'footrestZ + footrestHeight', ['back-left', 'back-right']);
      // Perpendicular footrests are staggered so their mortises never share a height in the leg.
      rail('Left footrest', false, sideFootrestZ, 'legLayer', `${sideFootrestZ} + footrestHeight`, ['front-left', 'back-left']);
      rail('Right footrest', false, sideFootrestZ, 'width - legLayer', `${sideFootrestZ} + footrestHeight`, ['front-right', 'back-right']);
      d.cutParts(layers, { with: rails, clearance: 'fit' });

      const seat = d.newPart('Seat', { thickness: 'seatBoard' });
      seat.profile.rect({ at: ['-overhang', '-overhang'], w: 'width + 2*overhang', h: 'depth + 2*overhang' });
      seat.place(at({ at: [0, 0, 'frameTop'] }));
      members.push({ role: 'seat', member: seat });
      const pilots = seat.sketchOn('underside');

      // Cleats span between the side aprons in closed, glued mortises below the seat. Screws drive up through them
      // from below into blind pilots, pulling the seat onto the frame.
      const cleats: PartEdit[] = [];
      for (const [index, sign] of ['-', '+'].entries()) {
        const name = `Seat cleat ${index + 1}`;
        const role = `seat-cleat-${index + 1}`;
        const y = `depth/2 ${sign} (depth/2 - leg)/2`;
        const low = `${y} - cleatWidth/2`,
          high = `${y} + cleatWidth/2`;
        const p = d.newPart(name, { thickness: 'board', relief: 'cutter' });
        p.profile
          .path(['legLayer + board/2', low])
          .lineTo(['width - legLayer - board/2', low])
          .lineTo(['width - legLayer - board/2', `${low} + shoulder`])
          .lineTo(['width - legLayer', `${low} + shoulder`])
          .lineTo(['width - legLayer', `${high} - shoulder`])
          .lineTo(['width - legLayer - board/2', `${high} - shoulder`])
          .lineTo(['width - legLayer - board/2', high])
          .lineTo(['legLayer + board/2', high])
          .lineTo(['legLayer + board/2', `${high} - shoulder`])
          .lineTo(['legLayer', `${high} - shoulder`])
          .lineTo(['legLayer', `${low} + shoulder`])
          .lineTo(['legLayer + board/2', `${low} + shoulder`])
          .close({ straight: true });
        p.place(at({ at: [0, 0, 'frameTop - cleatDrop - board'] }));
        members.push({ role, member: p });
        cleatRoles.push(role);
        cleats.push(p);
        connections.push(
          { id: `${role}-left`, kind: 'glued-shouldered-tenon', roles: ['left-apron', role], hardwareIds: [] },
          { id: `${role}-right`, kind: 'glued-shouldered-tenon', roles: ['right-apron', role], hardwareIds: [] }
        );
        const screws: string[] = [];
        for (const [k, x] of ['width/4', 'width*3/4'].entries()) {
          const clearance = p.profile.circle({ at: [x, y], d: 5.5 });
          // Underside sketches reverse local X.
          const pilot = pilots.circle({ at: [`-(${x})`, y], d: 3.5 });
          seat.cut(pilots.regionAt(-d.value(x), d.value(y)), { depth: 12 });
          const id = `${role}-screw-${k + 1}`;
          screws.push(id);
          hardware.push({
            id,
            kind: 'seat-screw',
            specification:
              'Purchased 5 × 40 mm pan-head wood screw with a 12 mm OD × 1 mm washer, driven from below through the cleat into a 3.5 mm blind pilot. Do not cut hardware from board stock.',
            holes: [
              { purpose: 'clearance', role, sketchId: p.profile.id, entityIds: [clearance.id] },
              { purpose: 'pilot', role: 'seat', sketchId: pilots.id, entityIds: [pilot.id] },
            ],
            lengthVariable: variables.screwLength!,
            diameter: 5,
            headDiameter: 10,
            headHeight: 3.5,
            washerDiameter: 12,
            washerThickness: 1,
            nutHeight: 0,
            minimumThreadProjection: 0,
            accessRadius: 8,
            accessLength: 40,
            installation: 'pilot-and-drive-from-below',
          });
        }
        connections.push({ id: `${role}-seat`, kind: 'seat-attachment', roles: [role, 'seat'], hardwareIds: screws });
      }
      d.cutParts(sideAprons, { with: cleats, clearance: 'fit' });
    });
    const sideRails = (corner: 'left' | 'right') => [`${corner}-apron`, `${corner}-footrest`];
    const side = (corner: 'left' | 'right') => [...legRoles.filter(r => r.includes(`-${corner}-`)), ...sideRails(corner)];
    root.construction({
      folderId: folder.id,
      recipe: 'frame-stool-glued-v1',
      parameters: Object.entries(variables).map(([name, variable]) => ({ name, variable })),
      members,
      connections,
      hardware,
      materials: (
        [
          [legRoles, 'solid-wood', 'profile-y', 'legLayer'],
          [[...railRoles, ...cleatRoles], 'solid-wood', 'profile-x', 'board'],
          [['seat'], 'plywood', 'profile-x', 'seatBoard'],
        ] as const
      ).map(([roles, kind, grain, stock]) => ({
        roles: [...roles],
        kind,
        grain,
        stock: options.measuredStock ? 'measured' : 'nominal',
        stockVariable: variables[stock]!,
        service: 'conditioned-dry-interior',
      })),
      adhesive: {
        kind: 'PVA-wood-glue',
        roles: [...legRoles, ...railRoles, ...cleatRoles],
        preparation:
          'Dry-fit every joint first. Glue freshly machined, clean faces at the adhesive maker’s stated moisture content and open time; coat both tenon cheeks and mortise walls.',
        clampingAndCure:
          'Clamp laminations flat across their full faces, and each frame square, at the adhesive maker’s stated pressure; leave clamped for its full stated cure before loading or attaching the seat.',
      },
      assembly: [
        { action: 'bond-laminations', roles: legRoles, hardwareIds: [], axis: '+x' },
        { action: 'insert-crosspieces', roles: side('left'), hardwareIds: [], axis: '+y' },
        { action: 'insert-crosspieces', roles: side('right'), hardwareIds: [], axis: '+y' },
        {
          action: 'fit-second-side',
          roles: [...side('right'), 'front-apron', 'back-apron', 'front-footrest', 'back-footrest', ...cleatRoles],
          hardwareIds: [],
          axis: '-x',
        },
        { action: 'square-and-cure', roles: [...legRoles, ...railRoles, ...cleatRoles], hardwareIds: [], axis: '+z' },
        { action: 'attach-seat', roles: ['seat'], hardwareIds: [], axis: '-z' },
        { action: 'install-hardware', roles: [...cleatRoles, 'seat'], hardwareIds: hardware.map(h => h.id), axis: '+z' },
      ],
    });
  };
}
