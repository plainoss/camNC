import { parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { inspectCadDocument, type CadEditResult } from '@wbcnc/cad-script';

const stopped = (document: CadDocument, message = 'The candidate check was stopped.'): CadEditResult => ({
  ok: false,
  document,
  parts: [],
  scriptError: message,
  report: { ok: false, status: 'invalid', errors: [], warnings: [], parts: [] },
});
/** Full trusted acceptance inspects the checked source, never reruns potentially nondeterministic user JavaScript. */
export async function finalizeBrowserCandidate(
  checked: CadEditResult,
  signal: AbortSignal,
  options: { bit?: number } = {}
): Promise<CadEditResult> {
  if (signal.aborted) return stopped(checked.document);
  // Earlier script/expectation failures remain failures; adding toolpaths must not convert them into success.
  if (!checked.ok || checked.scriptError || !checked.report.ok || checked.report.errors.length) return { ...checked, ok: false };
  try {
    const candidate = parseCadDocument(structuredClone(checked.document));
    const trusted = await inspectCadDocument(candidate, new Map(), { toolpaths: true, bit: options.bit });
    if (signal.aborted) return stopped(candidate);
    const retained = checked.report.warnings.filter(warning => warning.code === 'close-straight');
    const known = new Set(trusted.report.warnings.map(warning => JSON.stringify(warning)));
    trusted.report.warnings.push(...retained.filter(warning => !known.has(JSON.stringify(warning))));
    return { ...trusted, ok: trusted.report.ok };
  } catch (error) {
    return stopped(checked.document, error instanceof Error ? error.message : 'The full candidate check failed.');
  }
}
