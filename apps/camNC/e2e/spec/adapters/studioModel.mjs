/** Source-document expectations shared by browser workflows and small adapter tests. */
export function studioState(document) {
  if (!document) throw new Error('The studio has no saved design');
  const referenceName = id => {
    for (const part of document.parts) {
      if (part.id === id) return part.name;
      const index = (part.copies ?? []).findIndex(copy => `${part.id}:${copy.id}` === id);
      if (index >= 0) return part.copies[index].name ?? `${part.name} ${index + 2}`;
    }
    return null;
  };
  return {
    sourceParts: document.parts.map(part => part.name),
    variables: Object.fromEntries((document.variables ?? []).map(variable => [variable.name, variable.expression])),
    thicknesses: Object.fromEntries(document.parts.map(part => [part.name, part.thickness])),
    copies: Object.fromEntries(document.parts.map(part => [part.name, part.copies?.length ?? 0])),
    identities: document.parts.map(part => [part.id, ...(part.copies ?? []).map(copy => copy.id)]),
    featureIds: {
      variables: (document.variables ?? []).map(variable => [variable.name, variable.id]),
      sketches: document.parts.map(part => [part.name, part.sketch.id]),
      patterns: document.parts.map(part => [part.name, part.pattern?.id ?? null]),
      partCuts: (document.partCuts ?? []).map(cut => cut.id),
    },
    partCuts: document.partCuts?.length ?? 0,
    patterns: Object.fromEntries(document.parts.map(part => [part.name, part.pattern ? {
      id: part.pattern.id, axis: part.pattern.axis, count: part.pattern.count,
      countExpression: part.pattern.countExpression ?? null, spacing: part.pattern.spacing,
      spacingExpression: part.pattern.spacingExpression ?? null,
    } : null])),
    offsets: Object.fromEntries(document.parts.map(part => [part.name, part.drawnOn ? {
      value: part.drawnOn.offset, expression: part.drawnOn.offsetExpression ?? null,
    } : null])),
    copyIds: Object.fromEntries(document.parts.map(part => [part.name, (part.copies ?? []).map(copy => copy.id)])),
    cutExpressions: (document.partCuts ?? []).map(cut => cut.clearanceExpression ?? null),
    cutSettings: (document.partCuts ?? []).map(cut => ({
      clearance: cut.clearance, suppressed: !!cut.suppressed, keepTools: !cut.consumeTools,
      tools: cut.tools.map(referenceName).sort(),
      targets: cut.targets.map(referenceName).sort(),
      ...(cut.split === undefined ? {} : { split: structuredClone(cut.split) }),
    })),
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
    } else if (['patterns', 'offsets'].includes(key)) {
      for (const [name, fields] of Object.entries(wanted)) {
        if (fields === null) equal(`${key}/${name}`, null, actual[key]?.[name]);
        else for (const [field, value] of Object.entries(fields)) equal(`${key}/${name}/${field}`, value, actual[key]?.[name]?.[field]);
      }
    } else if (key === 'cutSettings' || key === 'cutExpressions') equal(key, wanted, actual[key]);
    else if (key === 'dialogSelections') equal(key, wanted, actual.dialogSelections);
    else if (key === 'retainedIdsSince') {
      const before = checkpoints.get(wanted);
      if (!before) failures.push(`studio/${key}: unknown checkpoint ${wanted}`);
      else {
        for (const [index, previous] of before.identities.entries()) {
          const name = before.sourceParts[index], current = actual.identities[actual.sourceParts.indexOf(name)];
          // IDs belong to named source parts and copy slots. A flat set would
          // miss identities swapped between panels or between shelf instances.
          for (const [slot, id] of previous.entries()) equal(`${key}/${name}/${slot}`, id, current?.[slot]);
        }
      }
    } else if (key === 'addedCopyIdsSince') {
      const before = checkpoints.get(wanted.checkpoint), current = actual.copyIds?.[wanted.part] ?? [];
      if (!before) failures.push(`studio/${key}: unknown checkpoint ${wanted.checkpoint}`);
      else {
        const previous = before.copyIds?.[wanted.part] ?? [];
        // Copy index names the visible shelf instance, so retaining a set while
        // swapping existing IDs between slots would still break edit identity.
        equal(`${key}/retained`, true, previous.every((id, index) => current[index] === id));
        equal(`${key}/added`, wanted.count, current.filter(id => !previous.includes(id)).length);
        equal(`${key}/unique`, current.length, new Set(current).size);
      }
    } else if (key === 'samePatternIdsSince') {
      const before = checkpoints.get(wanted);
      if (!before) failures.push(`studio/${key}: unknown checkpoint ${wanted}`);
      else for (const [name, pattern] of Object.entries(before.patterns)) if (pattern) equal(`${key}/${name}`, pattern.id, actual.patterns?.[name]?.id);
    } else if (key === 'thicknesses') {
      for (const [name, value] of Object.entries(wanted)) {
        if (!Number.isFinite(actual.thicknesses[name]) || Math.abs(actual.thicknesses[name] - value) > 0.001)
          failures.push(`studio/thicknesses/${name}: wanted ${value}, got ${actual.thicknesses[name]}`);
      }
    } else if (['sourceParts', 'partCuts', 'dialog', 'listedParts', 'partIssues', 'workspacePartCount'].includes(key)) equal(key, wanted, actual[key]);
    else if (['sameIdsSince', 'sameFeatureIdsSince', 'unchangedSince'].includes(key)) {
      const checkpoint = checkpoints.get(wanted);
      if (!checkpoint) failures.push(`studio/${key}: unknown checkpoint ${wanted}`);
      else {
        const field = key === 'sameIdsSince' ? 'identities' : key === 'sameFeatureIdsSince' ? 'featureIds' : 'content';
        equal(key, checkpoint[field], actual[field]);
      }
    } else failures.push(`studio/unsupported expectation: ${key}`);
  }
  return failures;
}
