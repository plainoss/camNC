import { createContext, useContext } from 'react';
import { plannedReliefBit } from '@/cam/planSettings';

/** Diameter, mm, of the bit the open job is planned with; new Dogbone corner relief starts at it. */
export const ReliefBitContext = createContext<number | undefined>(undefined);

/** The bit new corner relief starts at: the job's, or the app's default bit outside a job. */
export const useReliefBit = () => useContext(ReliefBitContext) ?? plannedReliefBit();
