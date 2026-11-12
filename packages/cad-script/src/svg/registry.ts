import { createSvgAssetStore, type SvgAssetStore } from './assets';
/** Application-owned registry: callers explicitly release a document's imported source
 * when its session ends. Store namespaces prevent stale/cross-document handle reuse.
 */
export function createDocumentSvgAssetRegistry() {
  const stores = new Map<string, SvgAssetStore>();
  return {
    forDocument(documentId: string): SvgAssetStore {
      if (!documentId || documentId.length > 200) throw new Error('A document identity is required for SVG assets.');
      let store = stores.get(documentId);
      if (!store) {
        // Empty stores can be reclaimed without invalidating any imported source handle.
        if (stores.size >= 16) for (const [id, entry] of stores) if (!entry.list().length) stores.delete(id);
        if (stores.size >= 16) throw new Error('SVG document asset limit reached. Release an unused document session first.');
        store = createSvgAssetStore();
        stores.set(documentId, store);
      }
      return store;
    },
    release(documentId: string): boolean {
      const store = stores.get(documentId);
      store?.clear();
      return stores.delete(documentId);
    },
    clear(): void {
      for (const store of stores.values()) store.clear();
      stores.clear();
    },
  };
}
