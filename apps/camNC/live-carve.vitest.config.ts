import { liveVitestConfig } from './src/test/live/config';

/** Opt-in live provider runs of the carving assistant; not part of any suite. See src/test/live/README.md. */
export default liveVitestConfig({
  name: 'carve',
  prefix: 'CARVE_LIVE',
  include: 'src/cam/carvingAssistant/live/**/*.live.ts',
  testTimeout: 3_600_000,
});
