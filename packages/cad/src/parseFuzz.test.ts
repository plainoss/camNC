import { describe, expect, it } from 'vitest';
import { parseCadDocument } from './document';
import { fuzzFailure, fuzzSeeds, fuzzSeedsFromEnv, seededRandom, type FuzzRandom } from './fuzz';
import { fuzzFixtureDocuments } from './fuzzFixtures';
import { solveCadDocument } from './solver';
import { closeTruncatedJson, mutateDocument } from './parseFuzzMutations';

/**
 * parseCadDocument's contract, as the design import shows it to people: it returns a document, or throws a plain `Error`
 * whose message says what is wrong. A TypeError or RangeError from deep inside is a crash, and a document it accepts
 * must load the whole way: serialize, parse again to the same document, and solve without throwing.
 */
async function expectCleanParse(input: unknown, { solve = true } = {}): Promise<'accepted' | 'refused'> {
  let document;
  try {
    document = parseCadDocument(input);
  } catch (error) {
    if (!(error instanceof Error) || error.constructor !== Error || !error.message)
      throw new Error(`parseCadDocument crashed instead of refusing the input: ${String(error)}`, { cause: error });
    return 'refused';
  }
  const saved = JSON.stringify(document);
  expect(JSON.stringify(parseCadDocument(JSON.parse(saved)))).toBe(saved);
  if (solve) await solveCadDocument(document);
  return 'accepted';
}

const fixtures = fuzzFixtureDocuments();
const replay = 'pnpm --filter @wbcnc/cad test -- run parseFuzz';
const timeout = fuzzSeedsFromEnv() ? 0 : 30_000;

async function forSeed(seed: number, run: (random: FuzzRandom, steps: string[]) => Promise<void>) {
  const steps: string[] = [];
  try {
    await run(seededRandom(seed), steps);
  } catch (cause) {
    throw fuzzFailure({ seed, steps, cause, replay });
  }
}

describe('parseCadDocument fuzz', () => {
  it('accepts every fixture as saved', async () => {
    for (const fixture of fixtures) expect(await expectCleanParse(JSON.parse(fixture.text)), fixture.name).toBe('accepted');
  });

  it.each(fuzzSeeds([1, 2]))(
    'refuses or fully loads documents truncated at many offsets (seed %i)',
    async seed =>
      forSeed(seed, async (random, steps) => {
        for (const fixture of fixtures) {
          // Evenly spaced cuts cover every part of the file; the seed moves them.
          const cuts = 16;
          for (let i = 0; i < cuts; i++) {
            const offset = Math.floor(((i + random.next()) / cuts) * fixture.text.length);
            // Each input stands alone, so the failing one is the whole replay.
            steps.splice(0, steps.length, `${fixture.name}: truncate at ${offset}`);
            const text = closeTruncatedJson(fixture.text.slice(0, offset));
            // The raw prefix is a JSON syntax error, which is JSON.parse's to report; the closed one is the parser's.
            await expectCleanParse(JSON.parse(text), { solve: random.chance(0.25) });
          }
        }
      }),
    timeout
  );

  it.each(fuzzSeeds([1, 2]))(
    'refuses or fully loads documents with wrong types, missing fields and swapped references (seed %i)',
    async seed =>
      forSeed(seed, async (random, steps) => {
        for (const fixture of fixtures) {
          for (let i = 0; i < 20; i++) {
            const document = JSON.parse(fixture.text) as unknown;
            const applied = Array.from({ length: 1 + random.int(3) }, () => mutateDocument(random, document));
            steps.splice(0, steps.length, `${fixture.name} mutant ${i}: ${applied.join('; ')}`);
            await expectCleanParse(document, { solve: random.chance(0.2) });
          }
        }
      }),
    timeout
  );

  it('refuses or loads oversized documents in bounded time', async () => {
    const plate = fixtures.find(fixture => fixture.name === 'plate (created)')!;
    const oversized: [string, () => unknown][] = [
      ['a 1 MB name', () => ({ ...JSON.parse(plate.text), name: 'x'.repeat(1 << 20) })],
      [
        '20 000 points',
        () => {
          const document = JSON.parse(plate.text);
          for (let i = 0; i < 20_000; i++) document.parts[0].sketch.entities.push({ id: `p${i}`, type: 'point', x: i, y: i });
          return document;
        },
      ],
      ['2 000 parts', () => ({ ...JSON.parse(plate.text), parts: Array.from({ length: 2000 }, (_, i) => partCopy(plate.text, i)) })],
      [
        'nested 5 000 deep',
        () => {
          let deep: unknown = 1;
          for (let i = 0; i < 5000; i++) deep = { deep };
          return { ...JSON.parse(plate.text), extra: deep };
        },
      ],
      ['a 2^31 pattern count', () => withPattern(fixtures, 2 ** 31)],
      ['1e308 coordinates', () => JSON.parse(plate.text.replace(/"x": ?\d+/g, '"x": 1e308'))],
    ];
    for (const [name, make] of oversized) {
      const started = performance.now();
      await expectCleanParse(make(), { solve: false });
      expect(performance.now() - started, name).toBeLessThan(5000);
    }
  });
});

/** A copy of the plate's part with fresh IDs, so a document can hold many. */
function partCopy(text: string, n: number) {
  const part = JSON.parse(text).parts[0];
  return JSON.parse(
    JSON.stringify(part)
      .replace(/"id":"([^"]+)"/g, `"id":"$1-${n}"`)
      .replace(/Id":"([^"]+)"/g, `Id":"$1-${n}"`)
  );
}

/** The cupboard's sketch pattern, made `count` wide. */
function withPattern(all: typeof fixtures, count: number) {
  for (const fixture of all) {
    const document = JSON.parse(fixture.text);
    for (const part of document.parts)
      for (const constraint of [part.sketch, ...(part.features ?? []).map((f: { sketch?: unknown }) => f.sketch)].flatMap(
        sketch => sketch?.constraints ?? []
      ))
        if (constraint.type === 'linearPattern') {
          constraint.countX = count;
          return document;
        }
  }
  throw new Error('No fixture has a sketch pattern');
}
