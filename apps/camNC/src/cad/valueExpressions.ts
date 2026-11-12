// Browser adapter re-exports the headless value parser.
import { parseCadValue as parseHeadless } from '@wbcnc/cad';
import { shownLength } from './shownLengths';

export { CAD_MAX_INPUT_MAGNITUDE, cadValueHasUnit, formatCadValue, type CadValueResult, type CadValueUnit } from '@wbcnc/cad';

/** The headless parser, where a field's untouched rounded length gives back the exact length it showed. */
export const parseCadValue: typeof parseHeadless = (text, options) => shownLength(text, options) ?? parseHeadless(text, options);
