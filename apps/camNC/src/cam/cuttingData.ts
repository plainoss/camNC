import { demoStorage } from '@/lib/demo/demo-storage';
import { create } from 'zustand';
import { combine, createJSONStorage, persist } from 'zustand/middleware';
import { without, type CuttingData, type CuttingField } from '@wbcnc/cam-settings';

export * from '@wbcnc/cam-settings';

/** Cutting data saved for a bit + material, for every job on this device. */
export const useCuttingData = create(
  persist(
    combine({ saved: {} as Record<string, Partial<CuttingData>> }, set => ({
      save: (key: string, patch: Partial<CuttingData>) => set(s => ({ saved: { ...s.saved, [key]: { ...s.saved[key], ...patch } } })),
      /** Forget one value (or the whole entry): the library or default applies again. */
      reset: (key: string, field?: CuttingField) =>
        set(s => {
          const { [key]: entry, ...rest } = s.saved;
          if (!field || !entry) return { saved: rest };
          const others = without(entry, field);
          return { saved: Object.keys(others).length ? { ...rest, [key]: others } : rest };
        }),
    })),
    { storage: createJSONStorage(() => demoStorage), name: 'camnc-cutting-data' }
  )
);
