import type { CadScript, Len, PartCopy, PartEdit } from './editTypes';
import type { ScriptConstruction } from './constructionApi';
import { fail } from './editExisting';

export interface PanelChairOptions {
  name?: string;
  /** Complete outside envelope, including the through-tenons and key heads. */
  width?: string;
  depth?: string;
  /** Usable seating between the side faces, separate from outside/key dimensions. */
  seatWidth?: string;
  seatDepth?: string;
  height?: string;
  seatHeight?: string;
  board?: string;
  cutter?: string;
  fit?: string;
  measuredStock?: boolean;
}

/** Bounded, demountable panel pattern. Ordinary source geometry remains editable. */
export function panelChair(options: PanelChairOptions = {}): CadScript {
  return root => {
    const variables: Record<string, string> = {};
    const members: ScriptConstruction['members'] = [];
    const connections: ScriptConstruction['connections'] = [];
    const hardware: ScriptConstruction['hardware'] = [];
    const assembly: ScriptConstruction['assembly'] = [];
    const grainX: string[] = [],
      grainY: string[] = [];
    const member = (role: string, part: PartEdit | PartCopy, grain: 'x' | 'y') => {
      members.push({ role, member: part });
      (grain === 'x' ? grainX : grainY).push(role);
    };
    let key: PartEdit,
      keyHole = '',
      keySketch = '';
    const folder = root.folder(options.name ?? 'Retained panel chair', d => {
      const set = (name: string, expression: string) => {
        variables[name] = d.variable(name, expression);
      };
      for (const [name, expression] of Object.entries({
        board: options.board ?? '18mm',
        seatWidth: options.seatWidth ?? '404mm',
        seatDepth: options.seatDepth ?? '402mm',
        width: options.width ?? 'seatWidth + 6*board',
        depth: options.depth ?? 'seatDepth + 2*board',
        height: options.height ?? '900mm',
        seatHeight: options.seatHeight ?? '450mm',
        cutter: options.cutter ?? '3.175mm',
        fit: options.fit ?? '0.1mm',
        keyPinInset: 'max(board/2; 9mm)',
        keyBoltLength: '5mm*floor((board + 16mm)/5mm)',
      }))
        set(name, expression);
      if (Math.abs(d.value('width - 6*board - seatWidth')) > 0.001 || d.value('depth - seatDepth - 2*board') < -0.001)
        return fail(
          'The keyed-panel layout cannot fit the requested usable seat and outside envelope together. Keep the usable seat and allow width = seatWidth + 6*board and depth >= seatDepth + 2*board, or choose a compact retained connector before offering a completed proposal.'
        );
      if (
        !(
          d.value('board') >= 16 &&
          d.value('board') <= 24 &&
          d.value('width - 6*board') > 160 &&
          d.value('depth') >= 360 &&
          d.value('height - seatHeight') >= 330 &&
          d.value('seatHeight - board') > 300 &&
          d.value('cutter') > 0 &&
          d.value('cutter') < 4.5 &&
          d.value('fit') >= 0 &&
          d.value('fit') <= 0.2
        )
      )
        return fail(
          'This panel-chair pattern needs 16–24 mm measured stock, adequate clear seat/depth/back space, cutter < 4.5 mm and calibrated per-side fit 0–0.2 mm. Change the layout or tooling before completing it.'
        );
      const sides = ['left', 'right'].map((side, i) => {
        const p = d.newPart(`${side} side`, { thickness: 'board', relief: 'cutter' });
        p.profile.rect({ at: [0, 0], w: 'depth', h: 'height' });
        p.place({ at: [i ? 'width - 3*board' : '2*board', 0, 0], x: '+y', y: '+z' });
        member(`${side}-side`, p, 'y');
        return p;
      });
      const crosspiece = (role: string, low: Len, high: Len, tongues: readonly [Len, Len][], horizontal: boolean, normal: Len) => {
        const expression = (value: Len) => (typeof value === 'number' ? `${value}mm` : value);
        const p = d.newPart(role, { thickness: 'board' });
        const path = p.profile.path(['3*board', low]).lineTo(['width - 3*board', low]);
        for (const [a, b] of tongues)
          path.lineTo(['width - 3*board', a]).lineTo(['width', a]).lineTo(['width', b]).lineTo(['width - 3*board', b]);
        path.lineTo(['width - 3*board', high]).lineTo(['3*board', high]);
        for (const [a, b] of [...tongues].reverse()) path.lineTo(['3*board', b]).lineTo([0, b]).lineTo([0, a]).lineTo(['3*board', a]);
        path.close({ straight: true });
        p.place(horizontal ? { at: [0, 0, normal] } : { at: [0, `(${expression(normal)}) + board`, 0], x: '+x', y: '+z' });
        member(role, p, 'x');
        tongues.forEach(([a, b], index) => {
          const center = `((${expression(a)}) + (${expression(b)}))/2`;
          for (const [i, side] of ['left', 'right'].entries()) {
            p.profile.rect({
              at: [i ? 'width - 2*board - fit' : 'board - fit', `(${center}) - board/2 - fit`],
              w: 'board + 2*fit',
              h: 'board + 2*fit',
            });
            const keyRole = `${role}-${side}-key-${index + 1}`;
            const position = horizontal
              ? {
                  at: [i ? 'width - 2*board' : '2*board', `(${center}) ${i ? '-' : '+'} board/2`, normal] as const,
                  x: i ? ('-x' as const) : ('+x' as const),
                  y: '+z' as const,
                }
              : {
                  at: [i ? 'width - 2*board' : '2*board', normal, `(${center}) ${i ? '+' : '-'} board/2`] as const,
                  x: i ? ('-x' as const) : ('+x' as const),
                  y: '+y' as const,
                };
            let physical: PartEdit | PartCopy;
            if (!key) {
              key = d.newPart('Headed retaining key', { thickness: 'board', relief: 'cutter' });
              key.profile
                .path(['-board', '-2*board'])
                .lineTo([0, '-2*board'])
                .lineTo([0, '2*board'])
                .lineTo(['-2*board', '2*board'])
                .lineTo(['-2*board', 'board + 3mm'])
                .lineTo(['-board', 'board + 3mm'])
                .close({ straight: true });
              keyHole = key.profile.circle({ at: ['-keyPinInset', '-keyPinInset'], d: 4.5 }).id;
              keySketch = key.profile.id;
              key.place(position);
              physical = key;
            } else physical = key.copy({ ...position, name: keyRole });
            member(keyRole, physical, 'y');
            const boltId = `${keyRole}-bolt`;
            hardware.push({
              id: boltId,
              kind: 'key-locking-bolt',
              specification:
                'Purchased M4 headed machine bolt, two 12 mm OD × 1 mm washers, and a 5 mm prevailing-torque locknut; engage the locking insert. Do not cut hardware from board stock.',
              holes: [{ purpose: 'clearance', role: keyRole, sketchId: keySketch, entityIds: [keyHole] }],
              lengthVariable: variables.keyBoltLength!,
              diameter: 4,
              headDiameter: 7,
              headHeight: 4,
              washerDiameter: 12,
              washerThickness: 1,
              nutHeight: 5,
              minimumThreadProjection: 1.4,
              accessRadius: 8,
              accessLength: 40,
              installation: 'head-washers-prevailing-torque-nut',
            });
            connections.push({
              id: `${role}-${side}-${index + 1}`,
              kind: 'keyed-through-tenon',
              roles: [`${side}-side`, role, keyRole],
              hardwareIds: [boltId],
            });
            assembly.push({ action: 'install-keys', roles: [keyRole], hardwareIds: [], axis: horizontal ? '-z' : '-y' });
            assembly.push({
              action: 'install-hardware',
              roles: [keyRole],
              hardwareIds: [boltId],
              axis: horizontal ? (i ? '+y' : '-y') : i ? '-z' : '+z',
            });
          }
        });
        // Author both mates from the same editable parameters. A relieved key
        // opening can overlap the receiver's face, so using this whole member as
        // a rectangular cut-parts tool would falsely refuse its curved reach.
        // Explicit closed mortises avoid that unsupported tool representation;
        // the independent construction check still measures the actual fit.
        for (const [a, b] of tongues)
          for (const side of sides)
            side.profile.rect({
              at: horizontal
                ? [`(${expression(a)}) - fit`, `(${expression(normal)}) - fit`]
                : [`(${expression(normal)}) - fit`, `(${expression(a)}) - fit`],
              w: horizontal ? `(${expression(b)}) - (${expression(a)}) + 2*fit` : 'board + 2*fit',
              h: horizontal ? 'board + 2*fit' : `(${expression(b)}) - (${expression(a)}) + 2*fit`,
            });
        p.relief('cutter');
      };
      crosspiece(
        'Seat',
        0,
        'seatDepth',
        [
          [60, 120],
          ['seatDepth - 120mm', 'seatDepth - 60mm'],
        ],
        true,
        'seatHeight - board'
      );
      crosspiece(
        'Back',
        'seatHeight + 50mm',
        'height - 50mm',
        [
          ['seatHeight + 90mm', 'seatHeight + 150mm'],
          ['height - 160mm', 'height - 100mm'],
        ],
        false,
        'seatDepth'
      );
      crosspiece('Rear rail', 100, 200, [[125, 175]], false, 'seatDepth');
      crosspiece(
        'Front apron',
        'seatHeight - board - 92mm',
        'seatHeight - board',
        [['seatHeight - board - 66mm', 'seatHeight - board - 26mm']],
        false,
        40
      );
    });
    root.construction({
      folderId: folder.id,
      recipe: 'panel-chair-keyed-v1',
      parameters: Object.entries(variables).map(([name, variable]) => ({ name, variable })),
      members,
      connections,
      hardware,
      materials: [grainX, grainY].map((roles, i) => ({
        roles,
        kind: 'plywood',
        grain: i ? 'profile-y' : 'profile-x',
        stock: options.measuredStock ? 'measured' : 'nominal',
        stockVariable: variables.board!,
        service: 'conditioned-dry-interior',
      })),
      assembly: [
        { action: 'insert-crosspieces', roles: ['left-side', 'Seat', 'Back', 'Rear rail', 'Front apron'], hardwareIds: [], axis: '-x' },
        { action: 'fit-second-side', roles: ['right-side', 'Seat', 'Back', 'Rear rail', 'Front apron'], hardwareIds: [], axis: '-x' },
        ...assembly,
      ],
    });
  };
}
