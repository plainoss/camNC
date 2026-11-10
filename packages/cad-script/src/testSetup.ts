import { beforeEach } from 'vitest';
import { setImmediate } from 'node:timers/promises';

// Solving and CAM reporting can chain many microtask-only awaits across a file.
// Give worker RPC acknowledgements a real event-loop turn between tests, rather
// than starving Vitest's separate 60 s deadline. Test deadlines stay unchanged.
beforeEach(() => setImmediate());
