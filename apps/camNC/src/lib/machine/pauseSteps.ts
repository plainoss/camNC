import { t as translate } from '@wbcnc/i18n';
import type { PauseMarker } from '@wbcnc/cam/pauseMarker';

export interface Step {
  title: string;
  detail?: string;
  /** The part to hold down next: marked green, like its ring in the camera view. */
  hold?: boolean;
}

const kRouterOn = translate('Router on, then Resume');
const kRouterOnDetail = translate('If you switch the router by hand, turn it back on first. Otherwise Resume starts the spindle.');
/** M5 stops only a spindle the machine controls: a router switched by hand keeps turning until you switch it off. */
const kRouterOff: Step = {
  title: translate('Router off, if you switch it by hand'),
  detail: translate('The bit is up. The machine stopped its spindle, but not a router switched by hand: wait until the bit stands still.'),
};

/** What to do at one of our own pauses, in order, from its marker. */
export function pauseSteps(m: PauseMarker): { title: string; steps: Step[] } {
  switch (m.kind) {
    case 'start':
      return {
        title: translate('Ready to start'),
        steps: [
          { title: translate('Dust collection on, hands clear of the bit') },
          { title: kRouterOn, detail: translate('Resume starts the spindle at {{value1}} RPM, then the cut.', { value1: m.rpm }) },
        ],
      };
    case 'take-out':
      return {
        title: translate('Take out {{value1}}', { value1: m.part }),
        steps: [
          kRouterOff,
          { title: translate('Take out {{value1}}', { value1: m.part }) },
          ...(m.next
            ? [
                {
                  title: translate('Hold down {{value1}}', { value1: m.next }),
                  detail: translate('It’s cut loose right after Resume. Ringed green in the camera view.'),
                  hold: true,
                },
                { title: kRouterOn, detail: kRouterOnDetail },
              ]
            : [
                {
                  title: translate('Resume'),
                  detail: translate('That was the last part: the machine parks. Leave a router you switch by hand off.'),
                },
              ]),
        ],
      };
    case 'tab':
      return {
        title: translate('Tab {{value1}} of {{value2}}', { value1: m.n, value2: m.of }),
        steps: [
          kRouterOff,
          {
            title: translate('Hold {{value1}} at the green ring', { value1: m.part }),
            detail: translate('Away from the bit. Resume cuts through this tab.'),
            hold: true,
          },
          { title: kRouterOn, detail: kRouterOnDetail },
        ],
      };
    case 'done':
      return {
        title: translate('Program done'),
        steps: [
          { title: translate('Switch off a router you switch by hand') },
          { title: translate('Resume'), detail: translate('Ends the program.') },
        ],
      };
  }
}
