/**
 * The step script a render runs before its pictures: scenario steps, one per line, from `--steps` or `--steps-file`.
 * Each becomes one session line, so session commands such as `expect <json>` and `shot <name>` work in it too.
 */

/** Lines that would end or restart the session the render still needs. */
const REFUSED = new Set(['reset', 'quit']);

/** One step as a session line: a scenario's `{ "expect": ... }` object becomes `expect <json>`. */
export function stepLine(text, where = 'Step') {
  const line = text.trim();
  if (!line) throw new Error(`${where} is empty`);
  if (line.startsWith('{')) {
    let step;
    try {
      step = JSON.parse(line);
    } catch (error) {
      throw new Error(`${where} is not valid JSON: ${error.message}`);
    }
    if (!step || typeof step.expect !== 'object') throw new Error(`${where} is an object without "expect": ${line}`);
    return `expect ${JSON.stringify(step.expect)}`;
  }
  const verb = line.split(/\s/, 1)[0];
  if (REFUSED.has(verb)) throw new Error(`${where} can't be \`${verb}\` in a render: ${line}`);
  return line;
}

/**
 * A steps file: one step per line. Blank lines and lines starting with `#` or `//` are skipped, so a script can say
 * what it is doing. A line names its own line number when it is refused.
 */
export function parseStepsFile(text, name = 'steps file') {
  return text.split(/\r?\n/).flatMap((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return [];
    return [stepLine(line, `Line ${index + 1} of ${name}`)];
  });
}
