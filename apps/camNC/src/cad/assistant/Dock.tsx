import { useEffect, useRef, useState } from 'react';
import { evaluateCadDocument, type CadDocument } from '@wbcnc/cad';
import { compactCadReport, inspectCadDocument, renderCadViews } from '@wbcnc/cad-script';
import type { CadProposal } from '@wbcnc/cad-editor/proposal';
import { readAssistantCredentials, redactAssistantText, type AssistantCredentials } from './keyStore';
import type { AssistantImage, AssistantMessage } from './provider';
import { ProviderSettings } from './ProviderSettings';
import { readAssistantImage, rasterizeAssistantView } from './images';
import { resumeAssistantMessages, runDesignAssistant } from './loop';
import { checkScriptInBrowser } from './scriptCheck';
import { assistantGuide, guideSections } from './guide';
import { summarizeAssistantReport } from './report';
import { appendConversation, readConversation, recordAssistantEvent, subscribeConversation, writeConversation } from './conversationStore';
import { RunSettings, type AssistantRunSettings } from './RunSettings';
import type { AssistantRunUsage } from './runBudget';
import cupboardExample from '../../../../../packages/cad-script/examples/cupboard.cad.ts?raw';
import plateExample from '../../../../../packages/cad-script/examples/plate.cad.ts?raw';
import trayExample from '../../../../../packages/cad-script/examples/tray.cad.ts?raw';
import shelfExample from '../../../../../packages/cad-script/examples/shelf-side.cad.ts?raw';
import './dock.css';
import type { AssistantSelection } from './selection';

const examples = { cupboard: cupboardExample, plate: plateExample, tray: trayExample, 'shelf-side': shelfExample };

export function AssistantDock({
  document,
  selection,
  disabled,
  onProposal,
  onClose,
}: {
  document: CadDocument;
  selection?: AssistantSelection;
  disabled?: boolean;
  onProposal: (proposal: CadProposal) => void;
  onClose: () => void;
}) {
  const [credentials, setCredentials] = useState<AssistantCredentials | null>(() => readAssistantCredentials());
  const [settings, setSettings] = useState(!credentials);
  const [messages, setMessages] = useState<AssistantMessage[]>(() => readConversation(document.id));
  const [runSettings, setRunSettings] = useState<AssistantRunSettings>({ limits: {} });
  const [usage, setUsage] = useState<AssistantRunUsage | null>(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState<AssistantImage[]>([]);
  const [readingImage, setReadingImage] = useState(false);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState('');
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<CadProposal | null>(null);
  const controller = useRef<AbortController | null>(null);
  const activeBase = useRef<string | null>(null);
  const stopReason = useRef('Stopped. The design is unchanged.');
  const previousDocument = useRef(JSON.stringify(document));
  const mounted = useRef(true);
  useEffect(
    () =>
      subscribeConversation(document.id, () => {
        const next = readConversation(document.id);
        setMessages(next);
        if (next.at(-1)?.proposalOutcome) setProposal(null);
      }),
    [document.id]
  );
  useEffect(() => {
    const snapshot = JSON.stringify(document);
    if (previousDocument.current === snapshot) return;
    previousDocument.current = snapshot;
    if (activeBase.current && activeBase.current !== snapshot) {
      stopReason.current = 'The design changed. Send again to work from the current design.';
      controller.current?.abort();
      setActivity(stopReason.current);
    }
    if (readConversation(document.id).length)
      recordAssistantEvent(
        document.id,
        'The open design changed. Its current context supersedes earlier candidate geometry. Earlier user constraints still apply.'
      );
  }, [document]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const send = async () => {
    if (running || readingImage || !credentials || (!text.trim() && !images.length)) return;
    const start = structuredClone(document);
    const user: AssistantMessage = { role: 'user', text: text.trim(), ...(images.length && { images }) };
    const transcript = [...resumeAssistantMessages(readConversation(document.id)), user];
    const abort = new AbortController();
    controller.current = abort;
    activeBase.current = JSON.stringify(start);
    stopReason.current = 'Stopped. The design is unchanged.';
    setText('');
    setImages([]);
    setMessages(transcript);
    setRunning(true);
    setError('');
    setProposal(null);
    writeConversation(start.id, transcript);
    try {
      setActivity('Reading the open design…');
      const inspected = await inspectCadDocument(start);
      if (abort.signal.aborted) return;
      const result = await runDesignAssistant({
        base: start,
        config: credentials.config,
        key: credentials.key,
        messages: transcript,
        guide: assistantGuide,
        guideSections,
        examples,
        limits: runSettings.limits,
        pricing: runSettings.pricing,
        onUsage: value => {
          if (mounted.current) setUsage(value);
        },
        signal: abort.signal,
        report: compactCadReport(inspected.document, inspected.report),
        context: JSON.stringify({
          selection,
          design: summarizeAssistantReport(compactCadReport(inspected.document, inspected.report), {
            partId: selection?.partId,
            partName: selection?.name,
          }),
        }),
        onMessage: message => {
          if (!mounted.current) return;
          const safe = JSON.parse(redactAssistantText(JSON.stringify(message), credentials.key)) as AssistantMessage;
          appendConversation(start.id, safe);
        },
        onActivity: message => {
          if (mounted.current) setActivity(message);
        },
        check: async (source, base, signal, options) => {
          const checked = await checkScriptInBrowser(base, source, { signal });
          if (signal.aborted) return checked;
          const views =
            checked.ok && credentials.config.images && options?.views
              ? await Promise.all(
                  renderCadViews(checked.document, checked.parts ?? evaluateCadDocument(checked.document).parts).map(view =>
                    signal.aborted ? Promise.reject(new DOMException('Stopped', 'AbortError')) : rasterizeAssistantView(view.svg, view.name)
                  )
                )
              : undefined;
          const detailReport = compactCadReport(checked.document, checked.report);
          return {
            ...checked,
            detailReport,
            report: summarizeAssistantReport(detailReport, { partId: selection?.partId, partName: selection?.name }),
            images: views,
          };
        },
      });
      if (!mounted.current) return;
      if (result.proposal && !abort.signal.aborted) setProposal(result.proposal);
      setActivity(
        result.status === 'stopped'
          ? 'Stopped. The design is unchanged.'
          : result.status === 'exhausted'
            ? (result.stopReason ?? `Stopped after ${result.checks} checks. No proposal was offered.`)
            : result.proposal
              ? 'Checked proposal ready to review.'
              : 'Waiting for your reply.'
      );
    } catch (cause) {
      if (mounted.current && !abort.signal.aborted)
        setError(redactAssistantText(cause instanceof Error ? cause.message : 'The assistant could not finish.', credentials.key));
    } finally {
      activeBase.current = null;
      if (mounted.current) {
        setRunning(false);
        if (abort.signal.aborted) setActivity(stopReason.current);
      }
    }
  };
  return (
    <aside className="cad-assistant-dock" aria-label="Design assistant" onKeyDown={event => event.stopPropagation()}>
      <header>
        <h2>Design assistant</h2>
        <button type="button" onClick={onClose} aria-label="Close assistant">
          Close
        </button>
      </header>
      <button type="button" disabled={running} onClick={() => setSettings(value => !value)}>
        {settings ? 'Messages' : 'Connection'}
      </button>
      {settings ? (
        <ProviderSettings
          value={credentials}
          onSave={value => {
            setCredentials(value);
            setSettings(!value);
          }}
        />
      ) : (
        <>
          <div className="cad-assistant-messages" role="log" aria-label="Conversation">
            {!messages.length && <p>Describe a piece to build or a change to your design. Add a picture for its look.</p>}
            {messages
              .filter(message => message.role !== 'tool' && (message.text || message.images?.length))
              .map((message, index) => (
                <article key={index}>
                  <strong>{message.event ? 'Design' : message.role === 'user' ? 'You' : 'Assistant'}</strong>
                  <p>{message.text}</p>
                  {message.images?.map((image, i) => (
                    <img key={i} src={`data:${image.mediaType};base64,${image.data}`} alt={image.name} />
                  ))}
                </article>
              ))}
          </div>
          {selection && <small>Selection: {selection.name}</small>}
          {proposal && (
            <div className="cad-assistant-proposal">
              <strong>Checked design proposal</strong>
              <p>Review the changes, lost cuts and warnings before applying.</p>
              {JSON.stringify(document) !== JSON.stringify(proposal.base) && (
                <p>The design has changed. Ask again against the current design.</p>
              )}
              <button
                type="button"
                disabled={disabled || JSON.stringify(document) !== JSON.stringify(proposal.base)}
                onClick={() => onProposal(proposal)}>
                Preview proposal
              </button>
              {disabled && <p>Complete the current edit before reviewing this proposal.</p>}
              <button
                type="button"
                onClick={() => {
                  recordAssistantEvent(document.id, 'The user discarded the checked proposal. It was not applied.', 'discarded');
                  setProposal(null);
                }}>
                Discard proposal
              </button>
            </div>
          )}
          <p role="status">{activity}</p>
          <RunSettings value={runSettings} usage={usage} disabled={running} onChange={setRunSettings} />
          {error && <p role="alert">{error}</p>}
          <form
            onSubmit={event => {
              event.preventDefault();
              void send();
            }}>
            <label>
              Message
              <textarea value={text} onChange={event => setText(event.target.value)} disabled={running} rows={3} />
            </label>
            <label>
              Reference image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                disabled={running || readingImage || !credentials?.config.images || images.length >= 3}
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) {
                    setReadingImage(true);
                    void readAssistantImage(file)
                      .then(image => {
                        if (mounted.current) setImages(previous => [...previous, image].slice(0, 3));
                      })
                      .catch(cause => {
                        if (mounted.current) setError(String(cause.message));
                      })
                      .finally(() => {
                        if (mounted.current) setReadingImage(false);
                      });
                  }
                }}
              />
            </label>
            {!credentials?.config.images && <small>Enable image support in Connection to attach a reference.</small>}
            {images.map((image, index) => (
              <div key={index}>
                {image.name}
                <button type="button" onClick={() => setImages(previous => previous.filter((_, at) => at !== index))}>
                  Remove image
                </button>
              </div>
            ))}
            {running ? (
              <button
                type="button"
                onClick={() => {
                  controller.current?.abort();
                  setActivity('Stopping…');
                }}>
                Stop
              </button>
            ) : (
              <button type="submit" disabled={readingImage || !credentials || (!text.trim() && !images.length)}>
                Send
              </button>
            )}
          </form>
          <button
            type="button"
            disabled={running}
            onClick={() => {
              writeConversation(document.id, []);
              setProposal(null);
              setActivity('');
              setUsage(null);
            }}>
            New conversation
          </button>
        </>
      )}
    </aside>
  );
}
