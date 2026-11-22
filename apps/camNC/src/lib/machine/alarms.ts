import { t as translate } from '@wbcnc/i18n';
import { isDemoMode } from '../demo/demo-mode';
import { describeAlarm, parseSoftLimitMessage, type Position } from '@wbcnc/fluidnc';

/** An alarm as camNC saw it: the code plus everything that helps to resolve it. */
export interface AlarmRecord {
  code: number;
  /** When camNC received `ALARM:N` (ms since epoch). */
  at: number;
  /** Controller `[MSG:…]` texts from shortly before and after the alarm, oldest first. */
  messages: string[];
  /** Machine position at the alarm. */
  mpos: Position | null;
  /** SD job running at the alarm. */
  job: { file: string; percent: number } | null;
  /** The controller has left the alarm state since. A later alarm camNC did not see must not show this one. */
  cleared?: boolean;
}

/** Travel per axis in machine coordinates, as far as known. */
export type TravelBounds = Partial<Record<'X' | 'Y' | 'Z', { min: number; max: number }>>;

export interface AlarmHelp {
  title: string;
  /** What happened, as concretely as the controller told us. */
  cause: string;
  /** What to do about it. */
  fix: string;
}

const fmt = (n: number) => n.toFixed(2).replace(/\.?0+$/, '');

/**
 * Turn an alarm into a concrete explanation and fix. `travel` fills in the soft limits where the controller does not
 * report them (3.9.x).
 */
export function explainAlarm(alarm: AlarmRecord, travel: TravelBounds = {}): AlarmHelp {
  const title = `ALARM:${alarm.code} ${translate(describeAlarm(alarm.code)).replace(/\.$/, '')}`;
  const where = alarm.job
    ? translate(' in {{file}} at {{percent}} %', { file: alarm.job.file.split('/').pop(), percent: alarm.job.percent.toFixed(1) })
    : '';
  switch (alarm.code) {
    case 1:
      return {
        title,
        cause: translate('A limit switch triggered while moving{{value1}}{{value2}}. The position is no longer trusted.', {
          value1: where,
          value2: limitSwitchHint(alarm.messages),
        }),
        fix: translate(
          'Check what hit the switch (wrong zero, job too large, or a noisy switch wire), then Unlock and home again before continuing.'
        ),
      };
    case 2: {
      const violation = alarm.messages.map(parseSoftLimitMessage).find(v => v !== null);
      if (!violation) {
        return {
          title,
          cause: translate("A move{{value1}} would leave the machine's travel.", { value1: where }),
          fix: translate(
            'Move the work zero further into the travel or make the job smaller, then Unlock (the position is still correct).'
          ),
        };
      }
      const limits = violation.min !== undefined && violation.max !== undefined ? violation : travel[violation.axis as 'X' | 'Y' | 'Z'];
      const range = limits
        ? translate(', outside the {{value1}} travel {{value2}} to {{value3}}', {
            value1: violation.axis,
            value2: fmt(limits.min!),
            value3: fmt(limits.max!),
          })
        : '';
      const over = limits ? (violation.target < limits.min! ? limits.min! - violation.target : violation.target - limits.max!) : null;
      const side = limits ? (violation.target < limits.min! ? 'minimum' : 'maximum') : 'edge';
      // FluidNC 3.9 checks every axis on every move: an axis already outside the travel stops a move that does not
      // even touch it, e.g. X one step below its minimum after homing stops the first Z lift of a job.
      const at = alarm.mpos?.[violation.axis.toLowerCase() as 'x' | 'y' | 'z'];
      if (at !== undefined && Math.abs(at - violation.target) < 0.005) {
        return {
          title,
          cause: translate(
            'The machine was already at {{value1}} {{value2}} (machine coordinates){{value3}}, so the controller stopped the next move{{value4}}, even one that does not move {{value5}}. This can happen right after homing, one step outside the travel.',
            { value1: violation.axis, value2: fmt(violation.target), value3: range, value4: where, value5: violation.axis }
          ),
          fix: translate(
            'Reset, then Unlock, jog {{value1}} {{value2}} by 1 mm and run again. Homing in camNC moves it back into the travel by itself.',
            { value1: violation.axis, value2: side === 'maximum' ? translate('down') : translate('up') }
          ),
        };
      }
      return {
        title,
        cause: translate(
          'The job{{value1}} moved {{value2}} to {{value3}} (machine coordinates){{value4}}. The toolpath reaches past the {{value5}} {{value6}}, or the work zero is too close to it.',
          { value1: where, value2: violation.axis, value3: fmt(violation.target), value4: range, value5: violation.axis, value6: side }
        ),
        fix:
          over !== null && over > 0
            ? translate(
                'Move the {{value1}} zero at least {{value2}} mm away from the {{value3}}, or shrink the job. Then Unlock: the position is still correct.',
                { value1: violation.axis, value2: fmt(Math.ceil(over * 100) / 100 + 0.01), value3: side }
              )
            : translate('Move the {{value1}} zero further into the travel or shrink the job. Then Unlock: the position is still correct.', {
                value1: violation.axis,
              }),
      };
    }
    case 3:
      return {
        title,
        cause: translate(
          'The controller was reset while moving{{value1}}. Steps may have been lost, so the position is no longer trusted.',
          { value1: where }
        ),
        fix: translate(
          'Home again (or re-zero all axes) before continuing. Resetting during a job always does this; use Pause to stop safely.'
        ),
      };
    case 4:
      return {
        title,
        cause: translate('The probe input was already active when probing started.'),
        fix: translate('Check the probe clip is not touching the plate (or the wire is not shorted), then Unlock and probe again.'),
      };
    case 5:
      return {
        title,
        cause: translate('The probe did not touch the plate within the probe travel.'),
        fix: translate(
          'Lower Z closer to the plate or increase the probe travel, check the clip is on the bit and the plate is under it, then Unlock and probe again.'
        ),
      };
    case 6:
    case 7:
    case 8:
    case 9:
      return {
        title,
        cause: homingCause(alarm.code, alarm.messages),
        fix:
          alarm.code === 8
            ? translate(
                'The axis did not move off its switch after pull-off: increase the pull-off distance in the config, or check the switch is not stuck. Then home again.'
              )
            : alarm.code === 9
              ? translate(
                  'The switch was not found within the search distance: check the switch and its wiring, that the axis can move freely, and the homing direction. Then home again.'
                )
              : translate('Home again once the cause is cleared.'),
      };
    case 11:
      return {
        title,
        cause: translate('A limit or control input was active when the controller started.'),
        fix: translate('Move the axis off its switch by hand (or check for a shorted input), then Unlock or reset.'),
      };
    case 14:
      return {
        title,
        cause: translate('The controller requires homing after start or reset.'),
        fix: translate('Home all axes. Unlock only if you are sure the position is still correct.'),
      };
    default:
      return {
        title,
        cause: translate('The controller stopped{{value1}}.', { value1: where }),
        fix: translate('Check the console for the controller messages around the alarm, then Unlock or home.'),
      };
  }
}

function limitSwitchHint(messages: string[]) {
  const hit = messages.map(m => m.match(/Limit switch tripped for ([A-Z])|limit.*?\b([XYZ])\b/i)).find(m => m);
  const axis = hit?.[1] ?? hit?.[2];
  return axis ? ` (${axis.toUpperCase()} axis)` : '';
}

function homingCause(code: number, messages: string[]) {
  const axis = messages.map(m => m.match(/Homing.*?\b([XYZ])\b/i)?.[1]).find(Boolean);
  const which = axis ? ` on ${axis.toUpperCase()}` : '';
  switch (code) {
    case 6:
      return translate('Homing{{value1}} was interrupted by a reset.', { value1: which });
    case 7:
      return translate('Homing{{value1}} was interrupted by the safety door.', { value1: which });
    case 8:
      return translate('Homing{{value1}} could not pull off the limit switch.', { value1: which });
    default:
      return translate('Homing{{value1}} did not find the limit switch.', { value1: which });
  }
}

/** When nothing is known about the alarm (it happened before this page or connection). */
export const kUnknownAlarmHelp: Omit<AlarmHelp, 'title'> = {
  cause: translate('camNC did not see this alarm happen: it was raised before this page connected, or while the connection was down.'),
  fix: translate(
    'If the controller just started or was reset, home it (Home all), or Unlock if you are sure the position is still correct. If it stopped during a job, the console may show why.'
  ),
};

const kStorageKey = 'camnc-last-alarm';

/** The last alarm per controller, kept for this browser tab so that it survives a reload or reconnect. */
export function saveLastAlarm(host: string, alarm: AlarmRecord) {
  if (isDemoMode()) return;
  try {
    sessionStorage.setItem(`${kStorageKey}:${host}`, JSON.stringify(alarm));
  } catch {
    // Storage full or unavailable: only this session loses it.
  }
}

export function loadLastAlarm(host: string): AlarmRecord | null {
  if (isDemoMode()) return null;
  try {
    const raw = sessionStorage.getItem(`${kStorageKey}:${host}`);
    return raw ? (JSON.parse(raw) as AlarmRecord) : null;
  } catch {
    return null;
  }
}
