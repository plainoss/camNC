// Only this trusted relay runs in the frame. Untrusted code runs in its worker, which cannot navigate a window.
const relay = () => {
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
        worker = new Worker(workerUrl);
        // A private channel prevents a script's global postMessage from impersonating the checker's result.
        const channel = new MessageChannel();
        channel.port1.onmessage = result => {
          terminate();
          channel.port1.close();
          port.postMessage({ type: 'result', result: result.data });
        };
        worker.onerror = () => {
          terminate();
          port.postMessage({ type: 'failed', message: 'The isolated script checker could not start.' });
        };
        worker.postMessage({ document: message.data.document, source: message.data.source }, [channel.port2]);
      } catch (error) {
        terminate();
        port.postMessage({
          type: 'failed',
          message: error instanceof Error ? error.message : 'The isolated script checker could not start.',
        });
      }
    };
    port.start();
    port.postMessage({ type: 'ready' });
  });
};

export const sandboxFrameHtml = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: data:; connect-src data:; worker-src blob: data:; child-src blob: data:;"><script>(${relay.toString()})();</script>`;
