import type { CadSavedTask } from './types';

const resize = 'Make it 800 wide and 900 tall, and give it three shelves, evenly spaced, instead of the one.';
const bench =
  'I need a shoe bench for the hallway: 900 wide, 450 high, 350 deep, from 18 mm plywood. A seat on top and one shelf for shoes underneath. It should hold together with joints I can cut on the CNC, no visible screws.';
const bookshelf =
  'A bookshelf, 800 wide, 1000 tall, 220 deep, 18 mm board. Four shelves between the top and bottom, housed in the sides, and a 6 mm back.';
const pins =
  "I'd rather have the shelves adjustable on pins, in 32 mm steps. Keep only the second shelf from the bottom fixed in its housing.";
const resizeOutcomes = [
  'Overall width is 800 mm and height is 900 mm.',
  'There are three shelves, with equal clear gaps between the shelves, top and bottom.',
  'Existing design entity IDs survive.',
];
const record = (id: string, model = 'Sonnet') => ({ model: `trial-${model}`, directory: `recordings/${id}` });

/** The nine original trial turns, including the second model's A1 request, plus whole-piece briefs. */
export const cadSavedTasks: readonly CadSavedTask[] = [
  {
    id: 'A1',
    request: resize,
    start: '../designs/task-start-cupboard.json',
    source: 'chat-trial',
    outcomes: resizeOutcomes,
    review: [],
    recording: record('A1'),
  },
  {
    id: 'H1',
    request: resize,
    start: '../designs/task-start-cupboard.json',
    source: 'chat-trial',
    outcomes: resizeOutcomes,
    review: [],
    recording: record('H1', 'Haiku'),
  },
  {
    id: 'A2',
    request: 'Cut a 60 mm cable hole near the back of the middle shelf only.',
    start: '../designs/task-start-cupboard-three-shelves.json',
    source: 'chat-trial',
    outcomes: [
      'Only the middle of the three shelves gains one 60 mm through hole.',
      'The hole is near the back and stays inside the shelf outline.',
      'The other shelves retain their previous geometry.',
    ],
    review: [],
    recording: record('A2'),
  },
  {
    id: 'A3',
    request: 'Put a second cupboard of the same kind right next to it on the right, but only 400 wide. The first one must stay as it is.',
    start: '../designs/task-start-cupboard-three-shelves.json',
    source: 'chat-trial',
    outcomes: [
      'Every existing part remains unchanged.',
      'A second cupboard is 400 mm wide, with the same height and depth as the first.',
      'The second cupboard begins at the first cupboard’s right edge.',
      'The new cupboard belongs to a folder named for it.',
    ],
    review: ['The new cupboard has the same construction and shelf arrangement as the first.'],
    recording: record('A3'),
  },
  {
    id: 'B1',
    request: bench,
    start: null,
    source: 'chat-trial',
    outcomes: [
      'Overall size is 900 × 350 × 450 mm (width, depth, height).',
      'Boards are 18 mm thick.',
      'A seat sits at the top and one shoe shelf is below it.',
      'Positive-depth CNC joints connect the horizontal boards to the sides.',
      'The new bench belongs to a folder named for it.',
    ],
    review: ['The construction holds together without visible screws.'],
    recording: record('B1'),
  },
  {
    id: 'B2',
    request:
      "Make it 1100 wide and add an upright divider in the middle, between the shelf and the seat. And round the seat's two front corners, radius 30.",
    start: '../designs/task-start-shoe-bench.json',
    source: 'chat-trial',
    history: [{ role: 'user', content: bench }],
    outcomes: [
      'Width becomes 1100 mm; height and depth stay 450 mm and 350 mm.',
      'An upright divider is centred between the seat and shoe shelf.',
      'The two front seat corners have radius 30 mm.',
      'Existing CNC housings keep positive depth; a solver pass after removing the housings is a failure.',
    ],
    review: ['The rounded front corners and joints fit without visible screws; ask if the construction cannot meet both.'],
    recording: record('B2'),
  },
  {
    id: 'C1',
    request: bookshelf,
    start: null,
    source: 'chat-trial',
    outcomes: [
      'Overall size is 800 × 220 × 1000 mm (width, depth, height).',
      'The sides, top, bottom and shelves are 18 mm board; the back is 6 mm.',
      'Four shelves sit between the top and bottom.',
      'All four shelves have positive-depth housings in the sides.',
      'The new bookshelf belongs to a folder named for it.',
    ],
    review: [],
    recording: record('C1'),
  },
  {
    id: 'C2',
    request: pins,
    start: '../designs/task-start-bookshelf.json',
    source: 'chat-trial',
    history: [{ role: 'user', content: bookshelf }],
    outcomes: [
      'All four shelves remain.',
      'Only the second shelf from the bottom is housed; the other three are loose.',
      'Both sides have pin holes on a 32 mm vertical pitch.',
    ],
    review: ['Loose shelves have clearance to move and sit on matching pins; top, bottom and back joints remain.'],
    recording: record('C2'),
  },
  {
    id: 'C3',
    request:
      'The shop only has 15 mm board. Switch to that. Does everything still fit together, and is anything now too weak or too close to an edge?',
    start: '../designs/task-start-bookshelf-with-pins.json',
    source: 'chat-trial',
    history: [
      { role: 'user', content: bookshelf },
      { role: 'user', content: pins },
    ],
    outcomes: [
      'Former 18 mm structural boards become 15 mm; the 6 mm back remains.',
      'The design still solves with no material collisions.',
      'The response identifies the 3 mm floor below the existing 12 mm pin holes.',
    ],
    review: ['The response explains the pin-hole floor and any edge clearances, without claiming that a geometry check proves strength.'],
    recording: record('C3'),
  },
  {
    id: 'stool',
    request: 'Build a stool.',
    start: null,
    source: 'whole-piece-requirement',
    outcomes: [
      'Ask for the intended dimensions and joints, or state the proposed dimensions and joints before building.',
      'If built, the new piece belongs to a folder named for it.',
      'If built, it comes from a construction pattern with retained joints and a fastened seat, and its measured construction checks pass.',
    ],
    review: ['A person accepts the proposed dimensions and joints before a candidate counts as a completed stool.'],
  },
  {
    id: 'rebuild-panel-chair',
    request:
      "This chair's seat, back and lower rail sit in open housings with nothing holding them, and the seat and back can pull out. Rebuild it so it holds together: keep the 404 mm clear seat between the sides, the 450 mm seat height and the 900 mm overall height, in 18 mm sheet.",
    start: '../designs/furniture-original-panel-chair.json',
    source: 'issue-input',
    outcomes: [
      'The chair is built from the retained keyed panel-chair pattern, and every measured joint, fit and hardware check passes.',
      'No open, unretained housing or loose original piece remains: every wooden piece is a member of the construction plan.',
      'The seat top is at 450 mm, the chair is 900 mm tall and 404 mm stays clear between the sides; nothing collides.',
    ],
    review: ['A person accepts the keyed envelope and hardware before the chair counts as complete; no load rating is claimed.'],
  },
  {
    id: 'rebuild-frame-stool',
    request:
      "This stool's rails sit in 10 mm notches cut from the legs and its seat isn't fastened to anything. Rebuild it with sound joints and a fastened seat, keeping the 650 mm seat height.",
    start: '../designs/furniture-original-frame-stool.json',
    source: 'issue-input',
    outcomes: [
      'The stool is built from the glued frame-stool pattern, and every measured tenon, web, fit and seat-fastening check passes.',
      'No shallow whole-rail notch or loose seat remains: every wooden piece is a member of the construction plan.',
      'The seat top is at 650 mm and nothing collides.',
    ],
    review: ['A person accepts the changed footprint and stock before the stool counts as complete; no load rating is claimed.'],
  },
  {
    id: 'shelf-description',
    request:
      'Build a small shelf with two tall sides, an open front and back, and three evenly spaced horizontal shelves. Make it 600 mm wide, 800 mm tall and 220 mm deep in 18 mm plywood; use housed joints.',
    start: null,
    source: 'whole-piece-requirement',
    outcomes: [
      'Overall size is 600 × 220 × 800 mm.',
      'There are two tall sides and three horizontal shelves, with no back.',
      'The shelves are evenly spaced and housed in the sides.',
      'The piece belongs to a named folder.',
    ],
    review: ['The front and rear stay visibly open, and the silhouette follows the short description.'],
  },
  {
    id: 'shelf-picture',
    request: 'Build a shelf that looks like the attached sketch. Use the dimensions in it, 18 mm plywood and housed joints.',
    start: null,
    source: 'whole-piece-requirement',
    attachments: [
      {
        file: 'reference/shelf.svg',
        mediaType: 'image/svg+xml',
        description: 'Authored front-view brief: 600 mm wide, 800 mm tall, two sides and three shelves; depth 220 mm. The rear is open.',
      },
    ],
    outcomes: [
      'Overall size is 600 × 220 × 800 mm.',
      'There are two sides, three horizontal shelves and no back.',
      'The piece belongs to a named folder.',
    ],
    review: ['A person compares the evaluated outline and cuts with the supplied picture; box bounds alone cannot pass the visual match.'],
  },
];

export function cadSavedTask(id: string): CadSavedTask {
  const task = cadSavedTasks.find(task => task.id === id);
  if (!task) throw new Error(`Unknown saved task ${id}. Choose ${cadSavedTasks.map(task => task.id).join(', ')}.`);
  return task;
}
