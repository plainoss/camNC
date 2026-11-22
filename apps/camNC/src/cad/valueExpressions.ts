import { parseCadValue as parseHeadlessValue, type CadValueResult } from '@wbcnc/cad';
import { localizeCadValueError } from './localizeCadValueError';

export { CAD_MAX_INPUT_MAGNITUDE, cadValueHasUnit, formatCadValue, type CadValueResult, type CadValueUnit } from '@wbcnc/cad';

/** Presentation adapter: the headless parser and numeric/serialized expressions stay unchanged. */
export function parseCadValue(...args: Parameters<typeof parseHeadlessValue>): CadValueResult {
  const result = parseHeadlessValue(...args);
  return 'error' in result ? { error: localizeCadValueError(result.error) } : result;
}
