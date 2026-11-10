import { parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { inspectCadDocument, type CadEditResult } from '@wbcnc/cad-script';
import runtime from 'virtual:cad-script-sandbox';
import { sandboxFrameHtml } from './sandboxFrame';

const failed = (document: CadDocument, message: string): CadEditResult => ({
  ok: false,
  document,
  parts: [],
  scriptError: message,
  report: { ok: false, status: 'invalid', errors: [], warnings: [], parts: [] },
});

/** A fresh opaque frame and worker for each attempt; no key, storage, network, or Apply capability enters it. */
export function checkScriptInBrowser(
  start: CadDocument,
  source: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<CadEditResult> {
  if (options.signal?.aborted) return Promise.resolve(failed(start, 'The script check was stopped.'));
  const timeoutMs = Math.min(60_000, Math.max(100, options.timeoutMs ?? 30_000));
  return new Promise(resolve => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Isolated design script checker';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.srcdoc = sandboxFrameHtml;
    const channel = new MessageChannel();
    let done = false;
    let closing: ReturnType<typeof setTimeout> | undefined;
    const remove = () => {
      if (closing) clearTimeout(closing);
      channel.port1.close();
      frame.remove();
    };
    const finish = (result: CadEditResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      // The relay stays responsive while a script loops. It terminates its worker before acknowledging this message.
      channel.port1.postMessage({ type: 'stop' });
      closing = setTimeout(remove, 100);
      resolve(result);
    };
    const abort = () => finish(failed(start, 'The script check was stopped.'));
    const timer = setTimeout(() => finish(failed(start, `The script check exceeded ${timeoutMs / 1000} seconds.`)), timeoutMs);
    channel.port1.onmessage = async (event: MessageEvent) => {
      const message = event.data;
      if (message?.type === 'stopped') {
        remove();
        return;
      }
      if (done) return;
      if (message?.type === 'ready') {
        channel.port1.postMessage({ type: 'check', document: start, source, runtime });
      } else if (message?.type === 'failed') finish(failed(start, message.message));
      else if (message?.type === 'result') {
        const result = message.result as CadEditResult & { failure?: string };
        if (result.failure) {
          finish(failed(start, result.failure));
          return;
        }
        try {
          const candidate = parseCadDocument(result.document);
          if (candidate.id !== start.id) throw new Error('A script must edit the same design.');
          if (!result.report || typeof result.ok !== 'boolean') throw new Error('The checker returned an invalid result.');
          if (!result.ok) {
            finish({ ...result, document: candidate });
            return;
          }
          // A script can modify globals in its disposable worker. Recheck source with the app's trusted runtime.
          const trusted = await inspectCadDocument(candidate);
          trusted.report.warnings.push(...(result.report.warnings ?? []).filter(warning => warning.code === 'close-straight'));
          finish({ ...trusted, ok: trusted.report.ok });
        } catch (error) {
          finish(failed(start, error instanceof Error ? error.message : 'Invalid design result.'));
        }
      }
    };
    channel.port1.start();
    frame.onload = () => frame.contentWindow?.postMessage({ type: 'connect' }, '*', [channel.port2]);
    options.signal?.addEventListener('abort', abort, { once: true });
    document.body.append(frame);
  });
}
