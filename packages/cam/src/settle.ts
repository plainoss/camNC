/**
 * Parts first, holds second: the parts are nested tight, the user puts clamps and screws where they'd go in the shop,
 * and only the parts in the way move aside (`settleCore.ts`). `settleHolds.ts` suggests where the holds go.
 */
export {
  fixtureBox,
  simplifyLoops,
  partDist,
  largestOffcut,
  reserved,
  fixtureFree,
  settle,
  screwPlay,
  snapScrew,
  clampPlay,
  edgeBands,
  surrounds,
  workBox,
  fixturesAround,
} from './settleCore';
export type { BoardSide, Fixture, SettlePart, SettleBoard, Spots, Settled, EdgeFit } from './settleCore';
export { defaultHolds, suggestHolds, moreHolds, fewerHolds, fitsMachine, suggestHoldsGrowing } from './settleHolds';
