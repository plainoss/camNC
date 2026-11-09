import { createCadDocument, createCadPart, parseCadDocument, solveCadDocument, type CadDocument } from '@wbcnc/cad';
import { fuzzFailure, fuzzSeeds, fuzzSeedsFromEnv, seededIds, seededRandom } from '@wbcnc/cad/fuzz';
import { fuzzFixtureDocuments } from '@wbcnc/cad/fuzzFixtures';
import { afterEach, expect, it, vi } from 'vitest';
import { FUZZ_COMMANDS, type FuzzCommand } from './commandFuzzCommands';
import { cadSession, commitCadSession, endCadSession, redoCadSession, undoCadSession } from './session';

/**
 * Seeded random editor commands on saved designs. After every step nothing has thrown, the document saves and loads
 * again, and it solves (a conflict is a result, not a crash); at the end Undo returns the design as it was opened and
 * Redo the edited one. A command the editor refuses for the current state is skipped.
 *
 * The defaults open each fixture once. `FUZZ_SEED=1234` replays one seed, `FUZZ_SEEDS=500` runs seeds 1..500 and
 * `FUZZ_STEPS` lengthens each run (20 steps by default).
 */
const STEPS = Number(process.env.FUZZ_STEPS) || 20;
const replay = 'pnpm --filter @wbcnc/cad-editor test -- run commandFuzz';
const fixtures = [
  ...fuzzFixtureDocuments(),
  { name: 'empty part', text: JSON.stringify({ ...createCadDocument('Empty'), parts: [createCadPart()] }) },
];
const content = (document: CadDocument) => JSON.stringify({ ...document, revision: 0 });

function expectLoads(document: CadDocument) {
  const saved = JSON.stringify(document);
  parseCadDocument(JSON.parse(saved));
}

const totalWeight = FUZZ_COMMANDS.reduce((sum, command) => sum + (command.weight ?? 1), 0);
function pickCommand(roll: number): FuzzCommand {
  let left = roll * totalWeight;
  for (const command of FUZZ_COMMANDS) if ((left -= command.weight ?? 1) < 0) return command;
  return FUZZ_COMMANDS.at(-1)!;
}

afterEach(() => {
  vi.restoreAllMocks();
});

it.each(fuzzSeeds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))(
  'editor commands keep the design loadable, solvable and undoable (seed %i)',
  async seed => {
    // The same seed makes the same IDs, so a replay makes the same choices.
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(seededIds(seed));
    const random = seededRandom(seed);
    const fixture = fixtures[seed % fixtures.length]!;
    const steps: string[] = [`open ${fixture.name}`];
    let id: string | undefined;
    try {
      const original = parseCadDocument(JSON.parse(fixture.text));
      id = original.id;
      endCadSession(id);
      const session = cadSession(original);
      for (let i = 0; i < STEPS; i++) {
        const roll = random.next();
        if (roll < 0.1) {
          steps.push('undo');
          undoCadSession(session);
          continue;
        }
        if (roll < 0.15) {
          steps.push('redo');
          redoCadSession(session);
          continue;
        }
        const command = pickCommand(random.next());
        steps.push(command.name);
        // FUZZ_LOG=1 names each step as it starts, to find one that hangs, and whether it applied.
        if (process.env.FUZZ_LOG) process.stderr.write(`seed ${seed} step ${i}: ${command.name}\n`);
        const outcome = await command.run(random, session.document);
        if (process.env.FUZZ_LOG) process.stderr.write(`seed ${seed} step ${i}: ${'refused' in outcome ? 'refused' : 'applied'}\n`);
        if ('refused' in outcome) {
          steps[steps.length - 1] += ` (refused: ${outcome.refused})`;
          continue;
        }
        if (outcome.note) steps[steps.length - 1] += ` (${outcome.note})`;
        const solved = await solveCadDocument(outcome.document);
        const next = commitCadSession(session, solved.status === 'solved' ? solved.document : outcome.document);
        expectLoads(next);
      }
      // A trailing Undo leaves later edits to redo; the newest edit is the far end of the history.
      while (session.future.length) redoCadSession(session);
      const edited = content(session.document);
      steps.push('undo all');
      while (session.past.length) undoCadSession(session);
      expect(content(session.document), 'Undo all the way returns the opened design').toBe(content(original));
      steps.push('redo all');
      while (session.future.length) redoCadSession(session);
      expect(content(session.document), 'Redo all the way returns the edited design').toBe(edited);
    } catch (cause) {
      throw fuzzFailure({ seed, steps, cause, replay });
    } finally {
      if (id) endCadSession(id);
    }
  },
  fuzzSeedsFromEnv() ? 0 : 30_000
);
