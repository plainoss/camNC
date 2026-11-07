import { demoStorage } from '@/lib/demo/demo-storage';
import { create } from 'zustand';
import { combine, createJSONStorage, persist } from 'zustand/middleware';
import { without, type CuttingData, type CuttingField } from '@wbcnc/cam-settings';

export * from '@wbcnc/cam-settings';

/** Cutting data saved for a bit + material, for every job on this device. */
export const useCuttingData = create(
  persist(
    combine({ saved: {} as Record<string, Partial<CuttingData>> }, set => ({
      save: (key: string, patch: Partial<CuttingData>, legacyKey?: string) =>
        set(s => ({ saved: { ...s.saved, [key]: { ...(s.saved[key] ?? (legacyKey ? s.saved[legacyKey] : undefined)), ...patch } } })),
      /** Forget one value (or the whole entry): the library or default applies again. */
      reset: (key: string, field?: CuttingField, legacyKey?: string) =>
        set(s => {
          const { [key]: current, ...rest } = s.saved;
          const entry = current ?? (legacyKey ? s.saved[legacyKey] : undefined);
          if (legacyKey && legacyKey !== key) {
            // An empty own entry deliberately blocks fallback after reset, including across reloads.
            return { saved: { ...rest, [key]: field && entry ? without(entry, field) : {} } };
          }
          if (!field || !entry) return { saved: rest };
          const others = without(entry, field);
          return { saved: Object.keys(others).length ? { ...rest, [key]: others } : rest };
        }),
    })),
    { storage: createJSONStorage(() => demoStorage), name: 'camnc-cutting-data' }
  )
);
