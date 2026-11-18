import path from 'node:path';

/** Where `shot <name>` writes: `<name>.png` relative to a file scenario, else beside the run's other results. */
export function shotPath(scenario, name, outDir) {
  const file = /\.png$/i.test(name) ? name : `${name || 'shot'}.png`;
  if (scenario.baseDir) return path.resolve(scenario.baseDir, file);
  if (!/^[\w.-]+$/.test(file)) throw new Error(`A shot name can only use letters, digits, dots and dashes: ${name}`);
  return path.join(outDir, `${scenario.id.replaceAll('/', '.')}.${file}`);
}
