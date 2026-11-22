import { t as translate } from '@wbcnc/i18n';
import { getCncApi } from '@/lib/fluidnc/machine';
import { MachineBoundsForm, MachineBoundsValues } from '@/setup/MachineBoundsForm';
import { Alert, AlertDescription, AlertTitle } from '@wbcnc/ui/components/alert';
import { Button } from '@wbcnc/ui/components/button';
import { useStore } from '@/store/store';
import { useEffect, useState } from 'react';

type ReadState = { kind: 'reading' } | { kind: 'read'; bounds: MachineBoundsValues } | { kind: 'failed'; message: string };

/**
 * Status states in which the axis travel is read. Single `$/axes/…` items only: `$CD` and `$#` were seen to reset
 * FluidNC 3.9.1. In Hold, FluidNC defers `$` commands until resume, so the read waits for Idle (or Alarm after power up).
 */
const kReadableStates = ['Idle', 'Alarm'];

/**
 * Once connected, reads the bed size from the controller's axis travel and lets the user confirm (or correct) it.
 * The values stay editable, and entering them by hand is always possible.
 */
export function BedFromMachine({
  onConfirmed,
  onRead,
}: {
  onConfirmed: () => void;
  /** Called with the size read from the controller, before the user confirms it. Must be stable. */
  onRead?: (bounds: MachineBoundsValues) => void;
}) {
  'use no memo';
  const api = getCncApi();
  const connected = api.isConnected.value;
  const readable = connected && kReadableStates.includes(api.state.value ?? '');
  const [read, setRead] = useState<ReadState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const setMachineBounds = useStore(s => s.setMachineBounds);

  useEffect(() => {
    if (!readable) return;
    let cancelled = false;
    setRead({ kind: 'reading' });
    api
      .readMachineBounds()
      .then(({ xmin, xmax, ymin, ymax }) => {
        if (cancelled) return;
        setRead({ kind: 'read', bounds: { xmin, xmax, ymin, ymax } });
        onRead?.({ xmin, xmax, ymin, ymax });
      })
      .catch((err: Error) => !cancelled && setRead({ kind: 'failed', message: err.message }));
    return () => {
      cancelled = true;
    };
    // Read once per connection (and on retry), not on every status change.
  }, [api, readable, attempt, onRead]);

  if (!connected) return null;
  if (!read || read.kind === 'reading') {
    return (
      <p className="text-sm text-muted-foreground" data-testid="bed-reading">
        {readable
          ? translate('Reading the axis travel from the controller…')
          : translate('Waiting for the machine to be idle ({{value1}})…', { value1: api.state.value ?? 'unknown' })}
      </p>
    );
  }
  if (read.kind === 'read' && !editing) {
    const { xmin, xmax, ymin, ymax } = read.bounds;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm" data-testid="bed-read">
          {translate('Your bed: X ')}
          {xmin}
          {translate(' to ')}
          {xmax}
          {translate(' mm, Y ')}
          {ymin}
          {translate(' to ')}
          {ymax}
          {translate(' mm (')}
          {xmax - xmin} × {ymax - ymin}
          {translate(' mm), read from the controller. ')}
        </p>
        <div className="flex flex-row gap-2">
          <Button
            onClick={() => {
              setMachineBounds(xmin, ymin, xmax, ymax);
              onConfirmed();
            }}>
            {translate('Open workspace ')}
          </Button>
          <Button variant="outline" onClick={() => setEditing(true)}>
            {translate('Adjust ')}
          </Button>
        </div>
        <HomingHint />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {read.kind === 'failed' && (
        <Alert>
          <AlertTitle>{translate('Could not read the bed size')}</AlertTitle>
          <AlertDescription>
            {read.message}
            {translate('. Enter it below, or')}{' '}
            <Button variant="link" className="h-auto p-0" onClick={() => setAttempt(a => a + 1)}>
              {translate('try again ')}
            </Button>
            .
          </AlertDescription>
        </Alert>
      )}
      <MachineBoundsForm
        initial={read.kind === 'read' ? read.bounds : undefined}
        submitLabel="Open workspace"
        showReadButton={false}
        onConfirmed={onConfirmed}
      />
      <HomingHint />
    </div>
  );
}

function HomingHint() {
  return (
    <p className="text-xs text-muted-foreground">
      {translate('Machine coordinates match the controller after homing. Home the machine before you double-click to jog. ')}
    </p>
  );
}
