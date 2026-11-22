import { t as translate, workerLanguageName } from '@wbcnc/i18n';
// Only this trusted relay runs in the frame. Untrusted code runs in its worker, which cannot navigate a window.
const relay = (failureMessage: string, workerName: string) => {
  window.addEventListener('message', function connect(event: MessageEvent) {
    if (event.source !== parent || event.ports.length !== 1) return;
    window.removeEventListener('message', connect);
    const port = event.ports[0]!;
    let worker: Worker | undefined;
    let workerUrl: string | undefined;
    const terminate = () => {
      worker?.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      workerUrl = undefined;
    };
    port.onmessage = (message: MessageEvent) => {
      if (message.data?.type === 'stop') {
        terminate();
        port.postMessage({ type: 'stopped' });
        return;
      }
      if (message.data?.type !== 'check' || worker) return;
      workerUrl = URL.createObjectURL(new Blob([message.data.runtime], { type: 'text/javascript' }));
      try {
        // Keep the worker entry alive through startup; completion, failure and cancellation each release its URL.
        worker = new Worker(workerUrl, { name: workerName });
        // A private channel prevents a script's global postMessage from impersonating the checker's result.
        const channel = new MessageChannel();
        channel.port1.onmessage = result => {
          terminate();
          channel.port1.close();
          port.postMessage({ type: 'result', result: result.data });
        };
        worker.onerror = () => {
          terminate();
          port.postMessage({ type: 'failed', message: failureMessage });
        };
        worker.postMessage({ document: message.data.document, source: message.data.source, toolpaths: message.data.toolpaths !== false }, [
          channel.port2,
        ]);
      } catch (error) {
        terminate();
        port.postMessage({
          type: 'failed',
          message: error instanceof Error ? error.message : failureMessage,
        });
      }
    };
    port.start();
    port.postMessage({ type: 'ready' });
  });
};

// The serialized relay has no module scope; pass translated text and locale explicitly.
const failureMessage = JSON.stringify(translate('The isolated script checker could not start.')).replace(/</g, '\\u003c');
const workerName = JSON.stringify(workerLanguageName('CAD script'));

export const sandboxFrameHtml = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: data:; connect-src data:; worker-src blob: data:; child-src blob: data:;"><script>(${relay.toString()})(${failureMessage},${workerName});</script>`;
