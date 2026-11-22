import { t as translate } from '@wbcnc/i18n';
import { parseCadDocument } from '@wbcnc/cad';
import { toast } from '@wbcnc/ui/components/sonner';
import { createJob, importDesignJob, kDesignFile, kModelFile, type CamJobV1 } from './jobDb';

/** Let the user pick a STEP/STL file; resolves to the new job, or null if nothing was picked. */
export function pickModelFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.step,.stp,.stl,.json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export const kNotAModel = translate('Not a STEP, STL or design file');

/** A file picked via "All files" (or dropped) that is no model: say so instead of doing nothing. */
export function toastNotAModel(fileName: string) {
  toast.error(kNotAModel, {
    description: translate("{{fileName}} can't be opened here. Open a .step, .stp, .stl or camNC design .json file.", {
      fileName: fileName,
    }),
  });
}

export async function createJobFromFile(file: File): Promise<CamJobV1> {
  if (kDesignFile.test(file.name)) return importDesignFile(file);
  if (!kModelFile.test(file.name)) throw new Error(translate('{{kNotAModel}}: {{value2}}', { kNotAModel: kNotAModel, value2: file.name }));
  return createJob(file);
}

/** Where a new job opens: a design goes to its sketch, to be checked and finished, and a model to its parts. */
export const firstStage = (job: CamJobV1) =>
  job.carving ? ('/cam/$jobId/carve' as const) : job.design ? ('/cam/$jobId/design' as const) : ('/cam/$jobId/model' as const);

async function importDesignFile(file: File): Promise<CamJobV1> {
  let document;
  try {
    document = parseCadDocument(JSON.parse(await file.text()));
  } catch (cause) {
    throw new Error(
      translate("{{value1}} isn't a camNC design: {{value2}}", {
        value1: file.name,
        value2: cause instanceof Error ? cause.message : String(cause),
      })
    );
  }
  return importDesignJob(document, file.name);
}

/**
 * Why a model can't be used, for people: the CAD kernel's own errors ("occt failed to read STEP file") mean a broken
 * or incomplete file, and the fix is a fresh export.
 */
export function modelReadError(fileName: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Our own messages are already for people.
  if (/missing|no planar faces/.test(raw)) return raw;
  if (/\.stl$/i.test(fileName))
    return translate(
      '{{value1}} could not be read: the STL file may be damaged or incomplete. Export it again from your CAD program and open the new file.',
      { value1: fileName }
    );
  return translate(
    '{{value1}} could not be read: the STEP file may be damaged or incomplete. Export it again from your CAD program as STEP and open the new file.',
    { value1: fileName }
  );
}
