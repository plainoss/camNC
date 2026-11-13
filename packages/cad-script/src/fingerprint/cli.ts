import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compareParts, defaultTolerances, type CompareTolerances, type FingerprintedPart } from './compare';
import type { PartFingerprint, Vec3 } from './meshFingerprint';
import { fingerprintStep, kFingerprintDeflection } from './stepFingerprint';

const usage =
  'fingerprint <file.step> | --compare <expected.step|expected.json> <actual.step> [--volume-tol 0.1] [--bbox-tol 0.01] [--distance-tol 0.05] [--samples 20000]';
const args = process.argv.slice(2).filter(argument => argument !== '--');
const cwd = process.env.INIT_CWD ?? process.cwd();

/** Bad input. Every error exits 2, so exit 1 always means the two files differ. */
class InputError extends Error {}

const round = (value: number) => +value.toFixed(6);
function rounded(part: PartFingerprint): PartFingerprint {
  const bbox = { min: part.bbox.min.map(round) as Vec3, max: part.bbox.max.map(round) as Vec3 };
  return { ...part, volume: round(part.volume), area: round(part.area), bbox };
}

async function read(file: string): Promise<{ file: string; parts: FingerprintedPart[] }> {
  const resolved = path.resolve(cwd, file);
  const data = await readFile(resolved).catch(() => {
    throw new InputError(`Can't read ${file}.`);
  });
  if (/\.json$/i.test(file)) {
    const json = JSON.parse(new TextDecoder().decode(data)) as { parts?: PartFingerprint[] };
    if (!Array.isArray(json.parts)) throw new InputError(`${file} is not a fingerprint: it has no parts.`);
    return { file: resolved, parts: json.parts.map(fingerprint => ({ fingerprint })) };
  }
  const parts = await fingerprintStep(data).catch(error => {
    throw new InputError(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  });
  return { file: resolved, parts };
}

try {
  const files: string[] = [];
  const tolerances: CompareTolerances = { ...defaultTolerances };
  let compare = false;
  const flags: Record<string, keyof CompareTolerances> = {
    '--volume-tol': 'volumePercent',
    '--bbox-tol': 'bbox',
    '--distance-tol': 'distance',
    '--samples': 'samples',
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === '--compare') compare = true;
    else if (argument in flags) {
      const value = Number(args[++index]);
      if (!Number.isFinite(value) || value < 0) throw new InputError(`${argument} needs a number. ${usage}`);
      tolerances[flags[argument]!] = value;
    } else if (argument.startsWith('--')) throw new InputError(`Unknown option ${argument}. ${usage}`);
    else files.push(argument);
  }
  if (files.length !== (compare ? 2 : 1)) throw new InputError(usage);
  // The reader can write diagnostics; stdout stays machine-readable.
  console.log = console.error.bind(console);
  if (compare) {
    const [expected, actual] = await Promise.all(files.map(read));
    if (!actual!.parts.every(part => part.mesh)) throw new InputError('The actual side must be a STEP file.');
    const result = compareParts(expected!.parts, actual!.parts, tolerances);
    process.stdout.write(`${JSON.stringify({ expected: expected!.file, actual: actual!.file, tolerances, ...result }, null, 2)}\n`);
    process.exitCode = result.equal ? 0 : 1;
  } else {
    const { file, parts } = await read(files[0]!);
    const report = { file, deflection: kFingerprintDeflection, parts: parts.map(part => rounded(part.fingerprint)) };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 2;
}
