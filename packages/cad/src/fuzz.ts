/**
 * Seeded fuzzing helpers for Node tests: a small PRNG, the seeds a run uses, deterministic IDs and a failure message that
 * says how to replay. Test-only; nothing in the product imports it.
 */

export interface FuzzRandom {
  readonly seed: number;
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [0, n). */
  int(n: number): number;
  /** A float in [min, max). */
  range(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Up to `count` distinct items, in a random order. */
  sample<T>(items: readonly T[], count: number): T[];
}

/** mulberry32: tiny, fast and good enough to drive test inputs. The same seed always gives the same sequence. */
export function seededRandom(seed: number): FuzzRandom {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return {
    seed,
    next,
    int,
    range: (min, max) => min + next() * (max - min),
    chance: p => next() < p,
    pick: items => {
      if (!items.length) throw new Error('Cannot pick from an empty list');
      return items[int(items.length)]!;
    },
    sample: (items, count) => {
      const pool = [...items];
      const out = [];
      while (out.length < count && pool.length) out.push(pool.splice(int(pool.length), 1)[0]!);
      return out;
    },
  };
}

/**
 * The seeds to run: `FUZZ_SEED=1234` replays one seed, `FUZZ_SEEDS=500` runs seeds 1..500, and otherwise the fixed
 * defaults that keep the normal suite fast.
 */
export function fuzzSeeds(defaults: readonly number[], env: Record<string, string | undefined> = process.env): number[] {
  const one = env.FUZZ_SEED?.trim();
  if (one) {
    const seed = Number(one);
    if (!Number.isSafeInteger(seed)) throw new Error(`FUZZ_SEED must be an integer, not ${one}`);
    return [seed];
  }
  const many = env.FUZZ_SEEDS?.trim();
  if (many) {
    const count = Number(many);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error(`FUZZ_SEEDS must be a positive integer, not ${many}`);
    return Array.from({ length: count }, (_, i) => i + 1);
  }
  return [...defaults];
}

/** Whether the run asked for more than the default seeds, so a test can lift its time limit. */
export const fuzzSeedsFromEnv = (env: Record<string, string | undefined> = process.env) =>
  !!(env.FUZZ_SEED?.trim() || env.FUZZ_SEEDS?.trim());

/** UUID-shaped IDs from a seed, so a replayed run makes the same IDs (and so the same choices) as the failing one. */
export function seededIds(seed: number): () => `${string}-${string}-${string}-${string}-${string}` {
  let n = 0;
  const prefix = (seed >>> 0).toString(16).padStart(8, '0');
  return () => {
    const tail = (n++).toString(16).padStart(12, '0');
    return `${prefix}-f022-4000-8000-${tail}`;
  };
}

/** The error a fuzz test throws: what broke, at which seed, and the steps that led there. */
export function fuzzFailure(options: { seed: number; steps: readonly string[]; cause: unknown; replay: string }): Error {
  const { seed, steps, cause, replay } = options;
  const reason = cause instanceof Error ? `${cause.name}: ${cause.message}\n${cause.stack ?? ''}` : String(cause);
  const list = steps.map((step, i) => `  ${i + 1}. ${step}`).join('\n');
  return new Error(
    `Fuzz seed ${seed} failed after ${steps.length} steps.\nReplay: FUZZ_SEED=${seed} ${replay}\nSteps:\n${list}\n${reason}`,
    {
      cause,
    }
  );
}
