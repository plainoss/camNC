import { cupboard, design } from '@wbcnc/cad-script';

// A folder of ordinary boards, rebate cuts, pin holes, a shelf pattern and their variables.
// Call cupboard again to insert another independent piece; later changes edit these same steps.
export { cupboard } from '@wbcnc/cad-script';
export default design(cupboard());
