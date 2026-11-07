import { kDefaultHardware, type HoldHardware } from '@wbcnc/cam-settings';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export { kDefaultHardware, type HoldHardware } from '@wbcnc/cam-settings';

export const useHoldHardware = create<{ hardware: HoldHardware; setHardware: (hardware: HoldHardware) => void }>()(
  persist(
    set => ({
      hardware: kDefaultHardware,
      setHardware: hardware => set({ hardware }),
    }),
    { name: 'cam-hold-hardware' }
  )
);
