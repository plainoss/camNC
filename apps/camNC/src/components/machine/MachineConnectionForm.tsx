import { t as translate } from '@wbcnc/i18n';
import { isDesktopApp } from '@/lib/desktop/is-desktop';
import { ConnectionState } from '@/lib/fluidnc/cnc-api';
import { getCncApi } from '@/lib/fluidnc/machine';
import { hostBlockedReason, machineSupport } from '@/lib/fluidnc/machine-support';
import { useStore } from '@/store/store';
import { Alert, AlertDescription, AlertTitle } from '@wbcnc/ui/components/alert';
import { Button } from '@wbcnc/ui/components/button';
import { Input } from '@wbcnc/ui/components/input';
import { Label } from '@wbcnc/ui/components/label';
import { useState } from 'react';
import { MachinePanel } from './MachinePanel';
import { ConnectionBadge } from './MachineStatusBar';

const kHelp: Partial<Record<ConnectionState, { title: string; text: string }>> = {
  'permission-denied': {
    title: translate('Local network access is blocked'),
    text: translate(
      'Chrome asked for permission to reach devices on your local network and it was denied. Allow it via the site settings (lock icon in the address bar → Local network access), then reconnect.'
    ),
  },
  unreachable: {
    title: translate('Controller not reachable'),
    text: translate(
      'Check the IP address (shown on the FluidNC WebUI or your router), that the controller is powered and in STA mode, and that this computer is on the same network. Browser and controller must be on the same LAN.'
    ),
  },
  'needs-permission': {
    title: translate('Chrome has not allowed local network access yet'),
    text: translate(
      'Allow it in the prompt, or in the site settings (lock icon in the address bar → Local network access), then reconnect. Each Chrome profile and each site (e.g. localhost vs. run.camnc.app) asks separately.'
    ),
  },
  'other-tab': {
    title: translate('camNC is controlling the machine in another tab'),
    text: translate(
      'Only one tab or window of this browser profile can control the machine. Close the other one and this tab takes over automatically, or take over now.'
    ),
  },
  'taken-over': {
    title: translate('Another tab took over the machine'),
    text: translate('This tab no longer controls the machine. Take it back here if you want to continue in this tab.'),
  },
};

/** Help states that offer taking the machine over from (or back to) this tab. */
const kTakeOver: ConnectionState[] = ['other-tab', 'taken-over'];

export function MachineConnectionForm() {
  'use no memo';
  const support = machineSupport();
  const machine = useStore(s => s.machine);
  const setMachine = useStore(s => s.setMachine);
  const [host, setHost] = useState(machine?.host ?? '');
  const [panelOpen, setPanelOpen] = useState(false);
  const cncApi = getCncApi();
  const connection = cncApi.connection.value;
  const firmware = cncApi.firmware.value;
  const variant = cncApi.variant.value;
  const blocked = hostBlockedReason(host);

  if (!support.supported) {
    return (
      <Alert>
        <AlertTitle>{translate('Machine control is not available in this browser')}</AlertTitle>
        <AlertDescription>
          {support.reason}
          {translate(' camNC still works as a viewer.')}
        </AlertDescription>
      </Alert>
    );
  }

  function connect(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = host.trim();
    if (!trimmed || hostBlockedReason(trimmed)) return;
    // Force a fresh connect (and variant detection) even if the host did not change.
    if (machine?.host === trimmed) {
      cncApi.disconnect();
      cncApi.connect(trimmed, machine.variant);
    } else {
      setMachine({ host: trimmed });
    }
  }

  const help = kHelp[connection];
  return (
    <>
      <form onSubmit={connect} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="machine-host">{translate('Controller IP address')}</Label>
          <div className="flex flex-row gap-2">
            <Input
              id="machine-host"
              placeholder="192.168.1.20"
              value={host}
              onChange={e => setHost(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" disabled={!host.trim() || !!blocked}>
              {translate('Connect ')}
            </Button>
            {machine && (
              <Button type="button" variant="outline" onClick={() => setMachine(null)}>
                {translate('Forget ')}
              </Button>
            )}
          </div>
          {blocked && (
            <p role="alert" className="text-xs text-destructive">
              {blocked}
            </p>
          )}
          {isDesktopApp() ? (
            <p className="text-xs text-muted-foreground">{translate("The controller's IP address or network name, e.g. 192.168.1.20.")}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {translate('Use the IP address. Chrome blocks router names like ')}
              <code>{translate('fluidnc.fritz.box')}</code>
              {translate(' from the HTTPS app, and ')}
              <code>{translate('.local')}</code>{' '}
              {translate(
                'names do not resolve reliably on Android and Windows. Chrome will ask to allow access to devices on your local network. '
              )}
            </p>
          )}
        </div>
        <div className="flex flex-row gap-2 items-center text-sm">
          <ConnectionBadge />
          {connection === 'connected' && (
            <Button type="button" size="sm" variant="outline" className="ml-auto order-last" onClick={() => setPanelOpen(true)}>
              {translate('Open machine panel ')}
            </Button>
          )}
          {connection === 'connected' && (
            <span className="text-muted-foreground">
              {translate('FluidNC ')}
              {firmware?.version ?? translate('unknown version')} ·{' '}
              {variant === 'v4' ? translate('WebSocket on the HTTP port') : translate('WebSocket on HTTP port + 1 (3.9.x)')}
            </span>
          )}
        </div>
        {help && !blocked && (
          <Alert variant="destructive">
            <AlertTitle>{help.title}</AlertTitle>
            <AlertDescription>
              {help.text}
              {kTakeOver.includes(connection) && (
                <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => cncApi.takeOver()}>
                  {connection === 'taken-over' ? translate('Take back control') : translate('Take over')}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
      </form>
      <MachinePanel open={panelOpen} onOpenChange={setPanelOpen} />
    </>
  );
}
