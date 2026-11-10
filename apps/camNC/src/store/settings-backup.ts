import superjson from 'superjson';
// Registers the superjson types for three.js values used in the settings.
import './store-storage';
import { ICamSource, useStore } from './store';

/** Marks a camNC settings backup file. */
const kBackupFormat = 'camnc-settings-backup';

/** What a backup file holds: the persisted settings. */
export type SettingsBackup = Partial<ReturnType<typeof useStore.getState>>;

/** All saved settings (cameras with their calibration, machine connection and bounds, macros, ...) as a file. */
export function exportSettingsBackup(): string {
  const { partialize } = useStore.persist.getOptions();
  const settings = partialize!(useStore.getState()) as SettingsBackup;
  return superjson.stringify({ format: kBackupFormat, settings });
}

export function backupFileName(date = new Date()) {
  return `camnc-settings-${date.toISOString().slice(0, 10)}.json`;
}

/** Reads a backup file. Throws an Error with a message for the user if it is not one. */
export function parseSettingsBackup(text: string): SettingsBackup {
  let data: unknown;
  try {
    data = superjson.parse(text);
  } catch {
    throw new Error('This file is not a camNC settings backup.');
  }
  const backup = data as { format?: string; settings?: unknown } | null;
  if (backup?.format === kBackupFormat && backup.settings && typeof backup.settings === 'object') return backup.settings as SettingsBackup;
  throw new Error('This file is not a camNC settings backup.');
}

/** The cameras in a backup, for showing what restoring it brings. */
export function backupCameras(backup: SettingsBackup): ICamSource[] {
  return Object.values(backup.camSources ?? {});
}

/** Restores a backup, replacing the saved settings. Its active camera becomes the active one, with its calibration and markers. */
export function restoreSettingsBackup(backup: SettingsBackup) {
  const { partialize } = useStore.persist.getOptions();
  const known = Object.keys(partialize!(useStore.getState()) as object);
  const settings = Object.fromEntries(Object.entries(backup).filter(([key]) => known.includes(key)));
  useStore.setState(settings);
}
