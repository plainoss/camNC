import { afterEach } from 'vitest';
import { resetSettled } from '@/lib/settled';

// Test files clean up their own pages first: Vitest runs this setup file's afterEach after theirs. Then nothing the test
// left behind (a query client, a call still running) counts against the next test's `settled()` (src/test/settled.ts).
afterEach(resetSettled);
