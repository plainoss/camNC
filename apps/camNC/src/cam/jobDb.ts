import { getRehearsalId, isDemoMode } from '@/lib/demo/demo-mode';
import { carvingBoard, carvingRegion, kCarvingBoard, kDefaultVBit, type CarvingV1 } from './carving';
import { outlineArt } from './carvingOutline';
import { rebaseJob } from './rebaseJob';
import { trackPending } from '@/lib/settled';
import type { BoardV1, StockBoardV1 } from './boards';
import type { NestObjective } from './autoNest';
import type { PartPrint } from './partMatch';
import type { PlanSettingsV1 } from './planSettings';
import { createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';

/**
 * CAM jobs live in IndexedDB, not in the persisted zustand store: model files are megabytes, and jobs are documents
 * the user opens, not app settings.
 */

export interface CamJobPartV1 {
  id: string;
  name: string;
  quantity: number;
  /** False for 3D-printed or bought parts: they stay out of boards. */
  milled: boolean;
}

export interface CamJobV1 {
  v: 1;
  /** Where a new job started; it remains a normal editable document. */
  origin?: { kind: 'sample'; id: string; revision: number } | { kind: 'designFile'; fileName: string };
  id: string;
  name: string;
  fileName: string;
  /** Native sketch drafts autosave independently of the geometry accepted by CAM. */
  design?: {
    draft: CadDocument;
    accepted?: CadDocument;
    acceptedRevision: number;
    /** Geometry revisions by permanent part ID, used to regenerate only affected boards. */
    partRevisions: Record<string, number>;
    /** Evaluated geometry content, independent of monotonic revision numbers and source annotations. */
    partGeometryKeys?: Record<string, string>;
    /** Removed hole targets retain their choices for Undo, but never apply to another hole. */
    holeChoiceIssues?: import('./holeChoices').MissingHoleChoice[];
  };
  /** A carving job: artwork V-carved into one board, instead of parts (see `carving.ts`). */
  carving?: CarvingV1;
  /** Goes up with every replaced model file: a file of the same name can hold another model. */
  modelRevision?: number;
  createdAt: number;
  updatedAt: number;
  /** Empty until the model has been imported once. */
  parts: CamJobPartV1[];
  /** Why the model file could not be read, for people (see `modelReadError`); unset once it has been read. */
  readError?: string;
  /** Which revision of the model `parts` come from, and what each part was: to find them again in a replaced model. */
  partsFrom?: { revision: number; prints: Record<string, PartPrint> };
  /** What a replaced model didn't let `parts` keep, for people, until dismissed (see `replaceWarning`). */
  replaceWarning?: string;
  /** Plan step choices (bit, material, ...); defaults until changed. */
  plan?: PlanSettingsV1;
  /** Boards the parts are nested on; derived per thickness until the user changes them. */
  boards?: BoardV1[];
  /** Board sizes the user has in the workshop, for "Auto-fill from stock". */
  stock?: StockBoardV1[];
  /** What "Auto-fill from stock" optimizes first: fewest boards (default) or least wood. */
  nestObjective?: NestObjective;
}

const kDbName = 'camnc-cam';
const kDemoDbName = 'camnc-cam-demo';
const kJobs = 'jobs';
const kModels = 'models';

const databases = new Map<string, Promise<IDBDatabase>>();

function openDb(name: string): Promise<IDBDatabase> {
  const existing = databases.get(name);
  if (existing) return existing;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(kJobs, { keyPath: 'id' });
      // Model bytes by job id, kept apart so listing jobs doesn't load them.
      db.createObjectStore(kModels);
    };
    req.onsuccess = () => {
      const db = req.result;
      const invalidate = () => {
        if (databases.get(name) === opening) databases.delete(name);
      };
      db.onclose = invalidate;
      db.onversionchange = () => {
        db.close();
        invalidate();
      };
      resolve(db);
    };
    req.onerror = () => {
      if (databases.get(name) === opening) databases.delete(name);
      reject(req.error);
    };
  });
  databases.set(name, opening);
  return opening;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function write(name: string, stores: string[], fn: (t: IDBTransaction) => void): Promise<void> {
  const done = openDb(name).then(
    db =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(stores, 'readwrite');
        fn(t);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
  // A write is pending for the specs' settled signal from the moment it is asked for, including opening the database.
  return trackPending('save', done);
}

/** Where jobs and their model bytes are kept. A model is only ever written together with its job. */
interface JobStore {
  list(): Promise<CamJobV1[]>;
  get(id: string): Promise<CamJobV1 | null>;
  getModel(id: string): Promise<Uint8Array | null>;
  /** Store `job`, whatever is stored under its id now. */
  put(job: CamJobV1, model?: ArrayBuffer): Promise<void>;
  /**
   * Read a job and store what `fn` makes of it, atomically; null from `fn` stores nothing. `fn` runs synchronously
   * against the stored job, or undefined when there is none. Resolves to what was stored, or null.
   */
  update(id: string, fn: (current: CamJobV1 | undefined) => CamJobV1 | null, model?: ArrayBuffer): Promise<CamJobV1 | null>;
  remove(id: string): Promise<void>;
}

// A save without a model leaves the models store unlocked.
const storesFor = (model: ArrayBuffer | undefined) => (model ? [kJobs, kModels] : [kJobs]);

const idbStore = (name: string): JobStore => ({
  async list() {
    const db = await openDb(name);
    return request(db.transaction(kJobs).objectStore(kJobs).getAll() as IDBRequest<CamJobV1[]>);
  },
  async get(id) {
    const db = await openDb(name);
    return (await request(db.transaction(kJobs).objectStore(kJobs).get(id) as IDBRequest<CamJobV1 | undefined>)) ?? null;
  },
  async getModel(id) {
    const db = await openDb(name);
    const buf = await request(db.transaction(kModels).objectStore(kModels).get(id) as IDBRequest<ArrayBuffer | undefined>);
    return buf ? new Uint8Array(buf) : null;
  },
  put: (job, model) =>
    write(name, storesFor(model), t => {
      t.objectStore(kJobs).put(job);
      if (model) t.objectStore(kModels).put(model, job.id);
    }),
  async update(id, fn, model) {
    let saved = null as CamJobV1 | null;
    await write(name, storesFor(model), t => {
      const jobs = t.objectStore(kJobs);
      const read = jobs.get(id) as IDBRequest<CamJobV1 | undefined>;
      read.onsuccess = () => {
        saved = fn(read.result);
        if (!saved) return;
        jobs.put(saved);
        if (model) t.objectStore(kModels).put(model, id);
      };
    });
    return saved;
  },
  remove: id =>
    write(name, [kJobs, kModels], t => {
      t.objectStore(kJobs).delete(id);
      t.objectStore(kModels).delete(id);
    }),
});

// Rehearsals deliberately restart from their handoff snapshot on reload, so their jobs are kept in memory only. Jobs
// are copied on the way in and out, as IndexedDB copies them: a caller never holds the stored object.
const rehearsalJobs = new Map<string, CamJobV1>();
const rehearsalModels = new Map<string, Uint8Array>();
const rehearsalStore: JobStore = {
  list: async () => structuredClone([...rehearsalJobs.values()]),
  get: async id => structuredClone(rehearsalJobs.get(id) ?? null),
  getModel: async id => rehearsalModels.get(id)?.slice() ?? null,
  async put(job, model) {
    rehearsalJobs.set(job.id, structuredClone(job));
    if (model) rehearsalModels.set(job.id, new Uint8Array(model));
  },
  async update(id, fn, model) {
    const saved = fn(structuredClone(rehearsalJobs.get(id)));
    if (saved) await rehearsalStore.put(saved, model);
    return saved;
  },
  async remove(id) {
    rehearsalJobs.delete(id);
    rehearsalModels.delete(id);
  },
};

const savedStore = idbStore(kDbName);
// Ordinary demo designs use their own persistent database, never the visitor's saved CAM projects.
const demoStore = idbStore(kDemoDbName);
// Capture once at public entry: file reads and IndexedDB requests may outlive leaving demo mode.
const currentStore = (): JobStore => (!isDemoMode() ? savedStore : getRehearsalId() ? rehearsalStore : demoStore);

export const kModelFile = /\.(step|stp|stl)$/i;
/** A CAD document saved as JSON, as `@wbcnc/cad-script` writes it. */
export const kDesignFile = /\.json$/i;

/** `name`, or "name (2)", "name (3)", … if a job of that name exists: opening the same file twice. */
export function uniqueJobName(name: string, taken: string[]): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  let k = 2;
  while (used.has(`${name} (${k})`)) k++;
  return `${name} (${k})`;
}

export type NewJobDefaults = Pick<
  Partial<CamJobV1>,
  'name' | 'origin' | 'plan' | 'boards' | 'stock' | 'parts' | 'partsFrom' | 'modelRevision' | 'nestObjective'
>;

type NewJobFields = Partial<CamJobV1> & Pick<CamJobV1, 'fileName'>;

/** A job of a name no other job has, stored together with its `model` file if it has one. */
async function newJob(
  store: JobStore,
  name: string,
  fields: (title: string) => NewJobFields | Promise<NewJobFields>,
  model?: File
): Promise<CamJobV1> {
  const now = Date.now();
  const title = uniqueJobName(
    name,
    (await store.list()).map(j => j.name)
  );
  const job: CamJobV1 = {
    parts: [],
    ...(await fields(title)),
    v: 1,
    id: crypto.randomUUID(),
    name: title,
    createdAt: now,
    updatedAt: now,
  };
  await store.put(job, await model?.arrayBuffer());
  return job;
}

export async function createJob(file: File, defaults: NewJobDefaults = {}): Promise<CamJobV1> {
  return newJob(
    currentStore(),
    defaults.name ?? file.name.replace(kModelFile, ''),
    () => {
      const { parts = [], ...fields } = structuredClone(defaults);
      return { ...fields, parts, fileName: file.name };
    },
    file
  );
}

/** Start a native flat-part design without an intermediate model file. */
export async function createDesignJob(name = 'Untitled design'): Promise<CamJobV1> {
  return newJob(currentStore(), name, title => {
    const draft = { ...createCadDocument(title), lengthUnit: 'cm' as const };
    draft.parts.push(createCadPart('Part 1'));
    return { fileName: title, design: { draft, acceptedRevision: 0, partRevisions: {} } };
  });
}

/**
 * Start a carving: an empty board, ready to add lettering, a file or AI artwork on the Carve step. `lettering` starts it
 * with that text centred on the board instead.
 */
export async function createCarvingJob(name = 'Untitled carving', { lettering }: { lettering?: string } = {}): Promise<CamJobV1> {
  return newJob(currentStore(), name, async title => {
    const items: CarvingV1['items'] = [];
    if (lettering) {
      const art = { kind: 'text' as const, text: lettering, font: 'serif' as const };
      const height = 30;
      const { region } = await outlineArt(art, height);
      items.push({ id: crypto.randomUUID(), art, height, x: kCarvingBoard.w / 2, y: kCarvingBoard.h / 2, rotation: 0, outline: region });
    }
    return {
      fileName: title,
      carving: { items, maxDepth: 3, vBit: kDefaultVBit, clearWithFlat: true, region: carvingRegion(items) },
      boards: [carvingBoard(kCarvingBoard)],
    };
  });
}

/**
 * Start a job from a design made outside the app, such as by a script. It's only ever a new job and a draft: new part
 * IDs in an existing job would mark its physical sheets out of date, and someone has to finish the sketch to use it.
 */
export async function importDesignJob(document: CadDocument, fileName: string): Promise<CamJobV1> {
  return newJob(currentStore(), document.name.trim() || fileName.replace(kDesignFile, ''), title => ({
    origin: { kind: 'designFile', fileName },
    fileName,
    design: { draft: { ...structuredClone(document), name: title }, acceptedRevision: 0, partRevisions: {} },
  }));
}

export async function listJobs(): Promise<CamJobV1[]> {
  return (await currentStore().list()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getJob(id: string): Promise<CamJobV1 | null> {
  return currentStore().get(id);
}

export function getModelBytes(id: string): Promise<Uint8Array | null> {
  return currentStore().getModel(id);
}

/** One version of a job's model: what its parts and programs are computed from. */
export const modelKey = (job: CamJobV1) =>
  job.carving
    ? `${job.id}:carving`
    : job.design
      ? `${job.id}:cad:${job.design.acceptedRevision}`
      : `${job.id}:${job.fileName}:${job.modelRevision ?? 0}`;

const updateForModel = (store: JobStore, source: CamJobV1, update: (current: CamJobV1) => CamJobV1 | null) =>
  store.update(source.id, current => {
    if (!current || modelKey(current) !== modelKey(source)) return null;
    const next = update(current);
    return next && { ...next, updatedAt: Date.now() };
  });

/** Save a document, or rebase an edit from `base` within the guarded transaction. */
export async function saveJob(job: CamJobV1, base?: CamJobV1): Promise<CamJobV1> {
  const store = currentStore();
  if (base) {
    const saved = await updateForModel(store, base, current => rebaseJob(base, job, current));
    if (!saved) throw new Error('This job or its model changed. Open it again before editing.');
    return saved;
  }
  const saved = { ...job, updatedAt: Date.now() };
  await store.put(saved);
  return saved;
}

/**
 * Commit an update only while its model still belongs to an existing job. Reading and writing in one transaction
 * keeps a late worker response from restoring a deleted job or putting old parts onto a replaced model.
 * `update` runs synchronously against the current job; null means there is nothing to save.
 */
export function updateJobForModel(source: CamJobV1, update: (current: CamJobV1) => CamJobV1 | null): Promise<CamJobV1 | null> {
  return updateForModel(currentStore(), source, update);
}

/** Swap the model file of a job; parts are re-derived on the next import, found again by what they are (`partMatch`). */
export async function replaceModel(job: CamJobV1, file: File): Promise<CamJobV1> {
  const store = currentStore();
  if (job.design) throw new Error('Open a model as a new job. Native designs are edited in Design.');
  const bytes = await file.arrayBuffer();
  // Reading a file or picking it in another tab can outlive edits, another replacement, or deletion. Derive the
  // revision from the stored job in the same transaction as the bytes, so every committed model has its own key.
  const saved = await store.update(
    job.id,
    current => {
      if (!current) return null;
      const next = { ...current, fileName: file.name, modelRevision: (current.modelRevision ?? 0) + 1, updatedAt: Date.now() };
      delete next.readError;
      return next;
    },
    bytes
  );
  if (!saved) throw new Error('This job no longer exists. Open another job before replacing its model.');
  return saved;
}

export function deleteJob(id: string): Promise<void> {
  return currentStore().remove(id);
}
