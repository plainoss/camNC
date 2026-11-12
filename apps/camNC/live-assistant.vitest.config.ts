import { liveVitestConfig } from './src/test/live/config';

/** Opt-in live provider runs of the design assistant; not part of any suite. See src/test/live/README.md. */
export default liveVitestConfig({
  name: 'assistant',
  prefix: 'ASSISTANT_LIVE',
  include: 'src/cad/assistant/live/**/*.live.ts',
  testTimeout: 600_000,
});
