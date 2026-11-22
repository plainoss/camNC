import { t as translate } from '@wbcnc/i18n';
import { useMachineSetupLocked } from '@/cam/machine/useMachineBusy';
import { getCncApi } from '@/lib/fluidnc/machine';
import { machineSupport } from '@/lib/fluidnc/machine-support';
import { workOffsetCommand } from '@/lib/fluidnc/work-offset';
import { moveToolpathToMachineZero, setXYZeroFromToolpath } from '@/lib/machine/jobs';
import {
  useHasToolpath,
  useSetShowMachinePosMarker,
  useSetShowMachineZero,
  useSetSnapToToolpath,
  useShowMachinePosMarker,
  useShowMachineZero,
  useSnapToToolpath,
  useStore,
} from '@/store/store';
import { Link } from '@tanstack/react-router';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@wbcnc/ui/components/dropdown-menu';
import { toast } from '@wbcnc/ui/components/sonner';
import { CircleArrowRight, CircleOff, ClipboardCopy, Crosshair, Download, Eye, EyeOff, Gamepad2, Joystick, Puzzle } from 'lucide-react';
import { useHotkeys } from 'react-hotkeys-hook';
import { TooltipIconButton } from './TooltipIconButton';

function copyZeroGcodePosition() {
  const { x, y } = useStore.getState().toolpathOffset;
  const zeroGcodePosition = workOffsetCommand({ x, y });
  navigator.clipboard.writeText(zeroGcodePosition);
  toast.success(translate('Zero command copied to clipboard'), {
    description: zeroGcodePosition,
  });
}

export function FluidncButton() {
  'use no memo';
  const cncApi = getCncApi();
  const hasToolpath = useHasToolpath();
  const isIdle = cncApi.isConnected.value && cncApi.state.value === 'Idle';
  const setupLocked = useMachineSetupLocked();
  const isFluidAvailable = hasToolpath && isIdle && !setupLocked;
  const status =
    '(' +
    [
      cncApi.isConnected.value ? (cncApi.state.value ?? 'connected') : translate('not connected'),
      ...(hasToolpath ? [] : [translate('no toolpath loaded')]),
    ].join(', ') +
    ')';
  const panelOpen = useStore(s => s.machinePanelOpen);
  const setPanelOpen = useStore(s => s.setMachinePanelOpen);

  const showMachinePosMarker = useShowMachinePosMarker();
  const setShowMachinePosMarker = useSetShowMachinePosMarker();
  const showMachineZero = useShowMachineZero();
  const setShowMachineZero = useSetShowMachineZero();
  const snapToToolpath = useSnapToToolpath();
  const setSnapToToolpath = useSetSnapToToolpath();

  if (!machineSupport().supported) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TooltipIconButton label={translate('Machine/FluidNC')} icon={<Joystick />} onClick={() => {}} />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>
            {translate('Machine ')}
            <span className="text-xs text-muted-foreground">{status}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setPanelOpen(!panelOpen)}>
            <Gamepad2 /> {panelOpen ? translate('Hide') : translate('Show')}
            {translate(' machine panel ')}
            <DropdownMenuShortcut>J</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!cncApi.isConnected.value || setupLocked} onClick={moveToolpathToMachineZero}>
            <Download />
            {translate(' Read machine zero → move toolpath ')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!hasToolpath} onClick={copyZeroGcodePosition}>
            <ClipboardCopy />
            {translate(' Copy zeroing gcode ')}
            {/* <DropdownMenuShortcut>
            <Kbd shortcut="meta+c" />
          </DropdownMenuShortcut> */}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!isFluidAvailable} onClick={() => setXYZeroFromToolpath(false)}>
            <CircleOff />
            {translate(' Set machine XY zero ')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!isFluidAvailable} onClick={() => setXYZeroFromToolpath(true)}>
            <CircleArrowRight />
            {translate(' Set XY zero and move to it. ')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowMachinePosMarker(!showMachinePosMarker)}>
            {showMachinePosMarker ? <EyeOff /> : <Eye />} {showMachinePosMarker ? translate('Hide') : translate('Show')}
            {translate(' machine position marker ')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowMachineZero(!showMachineZero)}>
            {showMachineZero ? <EyeOff /> : <Eye />} {showMachineZero ? translate('Hide') : translate('Show')}
            {translate(' zero axes ')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSnapToToolpath(!snapToToolpath)}>
            <Crosshair /> {snapToToolpath ? translate('Disable') : translate('Enable')}
            {translate(' snap to toolpath ')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/setup/fluidnc">
              <Puzzle />
              {translate(' Connection settings ')}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <MachinePanelHotkey onToggle={() => setPanelOpen(!useStore.getState().machinePanelOpen)} />
    </>
  );
}

function MachinePanelHotkey({ onToggle }: { onToggle: () => void }) {
  useHotkeys('j', onToggle, { preventDefault: true });
  return null;
}
