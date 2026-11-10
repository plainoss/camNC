# Chat proof of concept, 2026-11-10

Fresh agents stood in for the in-app assistant. Each had the guide
(`packages/cad-script/README.md`), the examples and two tools from `tool.mjs`:

- `context`: the open design as a report, with front, right and top views.
- `check`: run a script against a copy of the open design, and get the check report
  and drawings back.

Every turn after the first went to a new agent that had only the design, not the script
that made it. `tool.mjs` logged every check, so tries and failure kinds are measured.
Not tested: a real chat with history, the isolated browser frame, any provider API, or
more than one run per request.

## Turns

| Turn | Request                                               | Model  | Checks | Outcome                                                                                        |
| ---- | ----------------------------------------------------- | ------ | -----: | ---------------------------------------------------------------------------------------------- |
| A1   | Cupboard to 800 × 900, three even shelves             | Sonnet |      1 | Right. 8-line script, all 143 IDs kept                                                         |
| H1   | Same as A1                                            | Haiku  |      2 | Right. First try had the pattern count off by one                                              |
| B1   | Shoe bench from nothing                               | Sonnet |      1 | Right                                                                                          |
| C1   | Bookshelf, four housed shelves, back                  | Sonnet |      1 | Right                                                                                          |
| A2   | 60 mm hole in the middle shelf only                   | Sonnet |      5 | Can't be said. Offered a hole in all three shelves and said so                                 |
| B2   | 1100 wide, a divider, round the seat's front corners  | Sonnet |     10 | Passed, but dropped the housings to make the corners work. Went over the limit of 8            |
| C2   | Shelves on pins, second one stays housed              | Sonnet |      1 | Half done: pins added, housings can't be removed. Said so                                      |
| A3   | A second cupboard, 400 wide, beside the first         | Sonnet |      1 | Right. First cupboard unchanged byte for byte, but the generator was copied by hand (41 lines) |
| C3   | Switch to 15 mm board; does it fit, is anything weak? | Sonnet |      1 | Right. One-line script, and it found the 3 mm floor left under the pin holes                   |

24 checks in all: 13 passed, 7 stopped in the script, 4 failed the check, none failed the
type check. A check took 3 s at the median and 7.6 s at most. A turn took 32 to 134 s and
78k to 104k tokens, most of it the guide, the examples and the reports.

## What held

- Changing an open design with a short script works, and keeps every existing ID.
- Variable changes are the cheap, safe case (A1, C3).
- The agents said what they could not do instead of faking it (A2, C2).
- Build-from-nothing box furniture is first-try work when an example is close.

## What did not

1. **A script can add but hardly remove.** It can remove a part's own cut, and nothing
   else: no cut-parts step, pattern, copy, part or variable (C2, C3, B2).
2. **One copy can't be cut** (A2). Roadmap PR 22.
3. **A generator can't be used twice** (A3). Roadmap PR 24. The agent's workaround is what
   a folder scope would do for it: every name suffixed, and an offset variable.
4. **`d.part(name)` makes a part when the name isn't there.** Asking for the copy
   "Shelf 2" silently made an empty part (A2). An edit needs a way to find without making.
5. **The guide covers building, not changing.** How to get an existing corner, cut or
   step isn't in it. B2 threw errors on purpose to list methods and probe regions.
6. **A passing check hid a worse design** (B2). Housing depth went to zero, the cut-parts
   step "cuts nothing", and that is only a warning. A proposal needs a comparison with the
   open design: steps that cut before and don't now, joints lost, warnings gained.
7. **The request can conflict with the design** (B2: the seat's front corners sit inside
   the sides' housings). The assistant has to be able to ask. These runs forbade it.
8. **The design doesn't carry intent.** "No visible screws, CNC joints" from B1 was not
   known to the B2 agent. A chat keeps its history, but not across sessions or hand edits.
9. **Reports are large for patterns.** 56 pin holes are listed one by one: 27 to 31 KB of
   context, 58 KB for the two-cupboard check. A pattern should be one line.
10. **Without the type check, a wrong option name fails badly.** `thicknes`, `width` and
    `circl` give "Cannot read properties of undefined (reading 'trim')". With it, three
    exact messages with the fix. No attempt needed it here, but the browser has none.
11. **Likely bug:** after `d.variable('width', …)`, `regionAt` in the same script still
    finds regions where the old width put them (B2 attempts 5 to 7).

## Drawings

Every agent said the views told it little the numbers hadn't. They confirmed layouts at
a glance and never caught a mistake. The views here are boxes only; cuts aren't drawn in
place. Labels overlap in the top view.

## Files

- `tool.mjs`: the two tools. `ids.mjs`: which IDs survive an edit. `notypes.ts`: run a
  script with no type check.
- `A`, `B`, `C`, `H`: one folder per conversation. `turnN/script.cad.ts` is the offered
  script, `turnN/attempts/` every check with its report, `turnN/log.jsonl` the tally,
  `views.png` and `parts.png` the drawings.

## The requests, word for word

Each turn ran on the design named under "Started from". `design.json` in a conversation's
folder is the design its last applied turn left.

| Turn   | Started from             | Request                                                                                                                                                                                                               |
| ------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1, H1 | `cupboard.json`          | Make it 800 wide and 900 tall, and give it three shelves, evenly spaced, instead of the one.                                                                                                                          |
| A2     | `A/turn1/candidate.json` | Cut a 60 mm cable hole near the back of the middle shelf only.                                                                                                                                                        |
| A3     | `A/turn1/candidate.json` | Put a second cupboard of the same kind right next to it on the right, but only 400 wide. The first one must stay as it is.                                                                                            |
| B1     | nothing                  | I need a shoe bench for the hallway: 900 wide, 450 high, 350 deep, from 18 mm plywood. A seat on top and one shelf for shoes underneath. It should hold together with joints I can cut on the CNC, no visible screws. |
| B2     | `B/turn1/candidate.json` | Make it 1100 wide and add an upright divider in the middle, between the shelf and the seat. And round the seat's two front corners, radius 30.                                                                        |
| C1     | nothing                  | A bookshelf, 800 wide, 1000 tall, 220 deep, 18 mm board. Four shelves between the top and bottom, housed in the sides, and a 6 mm back.                                                                               |
| C2     | `C/turn1/candidate.json` | I'd rather have the shelves adjustable on pins, in 32 mm steps. Keep only the second shelf from the bottom fixed in its housing.                                                                                      |
| C3     | `C/turn2/candidate.json` | The shop only has 15 mm board. Switch to that. Does everything still fit together, and is anything now too weak or too close to an edge?                                                                              |

`cupboard.json` is `packages/cad-script/examples/cupboard.cad.ts` as checked on main at
`aa554c3`. A2's result was not applied, since it was not what the request asked for.
`typo.cad.ts` is the mistyped script behind finding 10.
