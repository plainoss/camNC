/** Source-document expectations shared by browser workflows and small adapter tests. */
export function studioState(document) {
  if (!document) throw new Error('The studio has no saved design');
  return {
    sourceParts: document.parts.map(part => part.name),
    variables: Object.fromEntries((document.variables ?? []).map(variable => [variable.name, variable.expression])),
    thicknesses: Object.fromEntries(document.parts.map(part => [part.name, part.thickness])),
    copies: Object.fromEntries(document.parts.map(part => [part.name, part.copies?.length ?? 0])),
    identities: document.parts.map(part => [part.id, ...(part.copies ?? []).map(copy => copy.id)]),
    partCuts: document.partCuts?.length ?? 0,
  };
}

/** A preview may change revision counters, but cancelling must restore the design's actual content. */
export function studioContent(document) {
  const { revision: _revision, ...content } = document;
  return JSON.stringify(content);
}

export function checkStudio(expected, actual, checkpoints = new Map()) {
  const failures = [];
  const equal = (label, want, got) => {
    if (JSON.stringify(want) !== JSON.stringify(got)) failures.push(`studio/${label}: wanted ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  for (const [key, wanted] of Object.entries(expected)) {
    if (['variables', 'copies'].includes(key)) {
      for (const [name, value] of Object.entries(wanted)) equal(`${key}/${name}`, value, actual[key]?.[name]);
    } else if (key === 'thicknesses') {
      for (const [name, value] of Object.entries(wanted)) {
        if (!Number.isFinite(actual.thicknesses[name]) || Math.abs(actual.thicknesses[name] - value) > 0.001)
          failures.push(`studio/thicknesses/${name}: wanted ${value}, got ${actual.thicknesses[name]}`);
      }
    } else if (['sourceParts', 'partCuts', 'dialog', 'listedParts', 'partIssues'].includes(key)) equal(key, wanted, actual[key]);
    else if (key === 'sameIdsSince' || key === 'unchangedSince') {
      const checkpoint = checkpoints.get(wanted);
      if (!checkpoint) failures.push(`studio/${key}: unknown checkpoint ${wanted}`);
      else equal(key, key === 'sameIdsSince' ? checkpoint.identities : checkpoint.content, key === 'sameIdsSince' ? actual.identities : actual.content);
    } else failures.push(`studio/unsupported expectation: ${key}`);
  }
  return failures;
}
