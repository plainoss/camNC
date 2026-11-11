import { carvingOperations, type BoardCarving } from '@wbcnc/cam';

self.onmessage = (event: MessageEvent<{ carving: BoardCarving; thickness: number }>) => {
  try {
    self.postMessage({ operations: carvingOperations(event.data.carving, event.data.thickness) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'CAM check failed.' });
  }
};
