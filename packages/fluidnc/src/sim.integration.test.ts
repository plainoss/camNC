/**
 * Runs against a real FluidNC: `pnpm sim` (4.x) or `pnpm sim --v3` (3.9.9 personality proxy), then
 *
 *   FLUIDNC_SIM_HOST=127.0.0.1:8848 pnpm vitest run sim.integration   # v4
 *   FLUIDNC_SIM_HOST=127.0.0.1:8850 pnpm vitest run sim.integration   # v3 personality
 */
import { positionWindow, startPauseGap } from '@wbcnc/cam/pauseMarker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readMachineBounds, readMaxRateXY } from './config';
import { deleteSdFile, listSdFiles, runSdFile, uploadSdFile } from './files';
import { FluidncAbortError, FluidncProtocol, MachineStatus } from './protocol';
import { FluidncSocket } from './socket';

const host = process.env.FLUIDNC_SIM_HOST;
const expectedVariant = process.env.FLUIDNC_SIM_VARIANT;

const until = async (predicate: () => boolean, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

describe.skipIf(!host)('FluidNC simulator', () => {
  let protocol: FluidncProtocol;
  const statuses: MachineStatus[] = [];

  beforeAll(async () => {
    protocol = new FluidncProtocol(new FluidncSocket({ host: host!, backoffMs: [100, 500] }));
    protocol.on('status', s => statuses.push(s));
    const connected = new Promise(resolve => protocol.on('connected', resolve));
    protocol.start();
    await connected;
    await protocol.send('$X').catch(() => {});
  });

  afterAll(() => protocol?.stop());

  it('detects the variant and the firmware version', () => {
    if (expectedVariant) expect(protocol.variant).toBe(expectedVariant);
    expect(protocol.buildInfo?.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('auto-reports status while jogging and cancels jogs', async () => {
    await protocol.send('G10 L20 P0 X0 Y0 Z0');
    const start = protocol.status!.mpos.x;
    await protocol.send('$J=G91 G21 X200 F3000');
    await until(() => protocol.status?.state === 'Jog');
    protocol.jogCancel();
    await until(() => protocol.status?.state === 'Idle');
    const moved = protocol.status!.mpos.x - start;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(200);
  });

  it('reads the XY max rate', async () => {
    expect(await readMaxRateXY(protocol)).toBeGreaterThan(0);
  });

  it('sets work offsets with G10', async () => {
    await protocol.send('G10 L20 P0 X0 Y0 Z0');
    protocol.realtime(0x3f);
    await until(() => Math.abs(protocol.status!.wpos.x) < 0.001);
  });

  it('reads bounds from $CD', async () => {
    const bounds = await readMachineBounds(protocol);
    expect(bounds.xmax - bounds.xmin).toBeCloseTo(1220, 0);
    expect(bounds.ymax - bounds.ymin).toBeCloseTo(2440, 0);
  });

  it('uploads with no-cors, verifies via ListJSON, runs and reports SD progress', async () => {
    const gcode = 'G21\nG90\nG0 X0 Y0\n' + Array.from({ length: 12 }, (_, i) => `G1 X${(i % 2) * 20} Y${i} F6000`).join('\n') + '\n';
    await uploadSdFile(protocol, host!, 'camnc-it.gcode', gcode);
    const listing = await listSdFiles(protocol);
    expect(listing.files.find(f => f.name.endsWith('camnc-it.gcode'))?.size).toBe(gcode.length);
    statuses.length = 0;
    await runSdFile(protocol, 'camnc-it.gcode');
    await until(() => statuses.some(s => s.job !== undefined && s.state === 'Run'));
    protocol.feedHold();
    // FluidNC ignores cycle start while the hold is still decelerating (Hold:1).
    await until(() => protocol.status?.state === 'Hold' && protocol.status.subState === 0);
    protocol.cycleStart();
    await until(() => protocol.status?.state === 'Idle' && protocol.status.job === undefined, 60_000).catch(e => {
      throw new Error(e.message + ' ' + JSON.stringify(statuses.slice(-3).map(s => [s.state, s.job])));
    });
    await deleteSdFile(protocol, 'camnc-it.gcode');
  }, 90_000);

  it('at an M0 reports the SD position just after it, and a feed hold in the cut somewhere else', async () => {
    // 320 short moves along a straight line and back: about 4 s at real time (CI runs the simulator at 1x), so the job
    // takes the same few seconds at any --speed, and enough lines that the reader is still in the cut when it is held.
    const moves = Array.from({ length: 320 }, (_, i) => `G1 X${(i < 160 ? i + 1 : 320 - i - 1) / 4} Y0 F1200`);
    const head = 'G21\nG90\nG0 X0 Y0\n(CAMNC PAUSE start; rpm=15000)\nM0 (MSG Router on, then Resume)\n';
    // M3 right after the start M0, as camNC writes it: the spindle state tells the two apart (no spindle is configured, so
    // this is the state FluidNC keeps for a router switched by hand).
    const gcode = head + 'M3 S15000\nG4 P3\n' + moves.join('\n') + '\nM5\nM0 (MSG Program done)\n';
    const sd = (end: number) => Math.round((10000 * end) / gcode.length) / 100;
    const held = () => protocol.status?.state === 'Hold' && protocol.status.subState === 0;
    await uploadSdFile(protocol, host!, 'camnc-m0.gcode', gcode);
    statuses.length = 0;
    await runSdFile(protocol, 'camnc-m0.gcode');
    await until(held, 30_000);
    // Reading stopped at the M0 itself, not lines ahead like the planner reads in the cut.
    expect(protocol.status!.job?.percent).toBe(sd(head.length));
    await until(() => protocol.status?.spindleOn !== undefined, 10_000);
    expect(protocol.status!.spindleOn).toBe(false);
    protocol.cycleStart();
    // The M3 is reported at once, not with the periodic override report: well within the 3 s dwell after it.
    const resumedAt = Date.now();
    await until(() => protocol.status?.spindleOn === true, 3_000);
    expect(Date.now() - resumedAt).toBeLessThan(1_500);
    // Held during the dwell, right after the M3: the reader is a line past the start M0, and the spindle shows running.
    protocol.feedHold();
    await until(held, 10_000);
    expect(Date.now() - resumedAt).toBeLessThan(3_000);
    expect(protocol.status!.job?.percent).toBe(sd(head.length + 'M3 S15000\nG4 P3\n'.length));
    expect(protocol.status!.spindleOn).toBe(true);
    protocol.cycleStart();
    await until(() => protocol.status?.state === 'Run' && (protocol.status.job?.percent ?? 0) > 30, 30_000);
    protocol.feedHold();
    await until(held, 30_000);
    const inCut = protocol.status!.job!.percent;
    // FluidNC reports a change of spindle state with the next report.
    expect(protocol.status!.spindleOn).toBe(true);
    expect(inCut).not.toBe(sd(head.length));
    expect(inCut).not.toBe(sd(gcode.length));
    protocol.cycleStart();
    await until(() => held() && protocol.status!.job!.percent > inCut, 60_000);
    expect(protocol.status!.job?.percent).toBe(sd(gcode.length));
    await until(() => protocol.status?.spindleOn === false, 10_000);
    protocol.cycleStart();
    await until(() => protocol.status?.state === 'Idle' && protocol.status.job === undefined, 60_000);
    await deleteSdFile(protocol, 'camnc-m0.gcode');
  }, 240_000);

  it('in a large camNC program, the gap after the start M0 lets the SD position tell that M0 from the dwell after M3', async () => {
    // About 1 MB: without the gap, the position window of the start M0 would reach past the M3 and the dwell.
    const head = 'G21\nG90\nG0 X0 Y0\n(CAMNC PAUSE start; rpm=15000)\nM0 (MSG Router on, then Resume)\n';
    const rest = 'M3 S15000\nG4 P3\n' + Array.from({ length: 40 }, (_, i) => `G1 X${(i + 1) / 4} Y0 F1200`).join('\n');
    const end = '\nM5\nM0 (MSG Program done)\n';
    const padding = Array.from({ length: 11_000 }, (_, i) => `(padding ${i} ${'-'.repeat(80)})`).join('\n') + '\n';
    const withoutGap = head.length + rest.length + end.length + padding.length;
    const gap = startPauseGap(withoutGap, 'M3 S15000\n'.length)
      .map(l => l + '\n')
      .join('');
    const gcode = head + gap + rest + end + padding;
    const size = gcode.length;
    const m3End = head.length + gap.length + 'M3 S15000\n'.length;
    // The machine view's rule for the start pause without knowing the spindle state: the furthest the reader can have
    // read is short of the end of the M3 line.
    const beforeM3 = () => (protocol.status!.job!.percent / 100) * size + positionWindow(size) < m3End;
    expect(size).toBeGreaterThan(1_000_000);
    // Without the gap the window would reach past the M3 line, so the position could not tell.
    expect(2 * positionWindow(size)).toBeGreaterThan('M3 S15000\n'.length);
    expect(gap.length).toBeGreaterThan(0);
    const held = () => protocol.status?.state === 'Hold' && protocol.status.subState === 0;
    await uploadSdFile(protocol, host!, 'camnc-gap.gcode', gcode);
    await runSdFile(protocol, 'camnc-gap.gcode');
    await until(held, 30_000);
    expect(beforeM3()).toBe(true);
    protocol.cycleStart();
    await until(() => protocol.status?.spindleOn === true, 3_000);
    protocol.feedHold();
    await until(held, 10_000);
    // In the dwell after the M3: not the start pause.
    expect(beforeM3()).toBe(false);
    const inDwell = protocol.status!.job!.percent;
    protocol.cycleStart();
    // On to the done M0.
    await until(() => held() && protocol.status!.job!.percent > inDwell, 60_000);
    protocol.cycleStart();
    await until(() => protocol.status?.state === 'Idle' && protocol.status.job === undefined, 120_000);
    await deleteSdFile(protocol, 'camnc-gap.gcode');
  }, 300_000);

  it('rejects in-flight commands on soft reset', async () => {
    const dwell = protocol.send('G4 P3', { timeoutMs: 0 }).catch(e => e);
    await new Promise(resolve => setTimeout(resolve, 100));
    protocol.softReset();
    expect(await dwell).toBeInstanceOf(FluidncAbortError);
    await until(() => protocol.isConnected());
    await protocol.send('$X').catch(() => {});
  });
});
