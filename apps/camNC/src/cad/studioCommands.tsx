import type { ReactNode } from 'react';

/** The studio's commands, as its toolbar and the tool search list them. */
export type StudioCommand =
  | 'sketch'
  | 'extrude'
  | 'cutParts'
  | 'transform'
  | 'pattern'
  | 'mirror'
  | 'hole'
  | 'fillet'
  | 'plane'
  | 'variable';

export const kStudioCommands: { id: StudioCommand; label: string; hint: string; glyph: ReactNode }[] = [
  {
    id: 'sketch',
    label: 'Sketch',
    hint: 'Sketch a new part on a plane or on a part’s face (Shift S): on the one picked, or pick one next',
    glyph: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  },
  {
    id: 'extrude',
    label: 'Extrude',
    hint: 'Extrude the selected sketch into a part, or change how thick a part is (Shift E)',
    glyph: <path d="M5 15h9v5H5zM5 15l4-4h9l-4 4M18 11v5l-4 4M9 11V4M7 6l2-2 2 2" />,
  },
  {
    id: 'cutParts',
    label: 'Cut parts',
    hint: 'Cut parts out of the parts they reach into, with a clearance',
    glyph: <path d="M3 9h18v9H3zM9 9V4h6v5M8 9v4h8V9" />,
  },
  {
    id: 'transform',
    label: 'Transform',
    hint: 'A copy of the selected part, moved along X, Y and Z',
    glyph: <path d="M4 14h8v6H4zM12 4h8v6h-8zM8 14V9h4M16 10v5h-4M10 7l2 2-2 2" />,
  },
  {
    id: 'pattern',
    label: 'Pattern',
    hint: 'Copies of the selected part in a row or around an axis',
    glyph: <path d="M3 8h4v8H3zM10 8h4v8h-4zM17 8h4v8h-4z" />,
  },
  {
    id: 'mirror',
    label: 'Mirror',
    hint: 'A mirror image of the selected part across a plane or a face',
    glyph: <path d="M12 3v18M9 6 4 18h5zM15 6l5 12h-5z" />,
  },
  {
    id: 'hole',
    label: 'Hole',
    hint: 'Round holes at the points of the selected sketch on a part’s face',
    glyph: <path d="M5 8h14v8H5zM12 8v8M9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0" />,
  },
  {
    id: 'fillet',
    label: 'Fillet',
    hint: 'Round a part’s edges through its thickness: click them in the view',
    glyph: <path d="M5 19V9a4 4 0 0 1 4-4h10M5 19h14" />,
  },
  {
    id: 'plane',
    label: 'Plane',
    hint: 'A plane to sketch on, offset from a plane or a part’s face',
    glyph: <path d="M3 17l5-6h13l-5 6zM3 11l5-6h13l-5 6" />,
  },
  {
    id: 'variable',
    label: 'Variable',
    hint: 'A named size, such as the board thickness, that any value can use',
    glyph: <path d="M8 5C5 8 5 16 8 19M16 5c3 3 3 11 0 14M10 9l4 6M14 9l-4 6" />,
  },
];
