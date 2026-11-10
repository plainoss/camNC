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
import guide from '../../../../../packages/cad-script/README.md?raw';
import cupboardExample from '../../../../../packages/cad-script/examples/cupboard.cad.ts?raw';
import plateExample from '../../../../../packages/cad-script/examples/plate.cad.ts?raw';
import trayExample from '../../../../../packages/cad-script/examples/tray.cad.ts?raw';
import shelfExample from '../../../../../packages/cad-script/examples/shelf-side.cad.ts?raw';
import './dock.css';
import type { AssistantSelection } from './selection';

const conversations = new Map<string, AssistantMessage[]>();
const examples = { cupboard: cupboardExample, plate: plateExample, tray: trayExample, 'shelf-side': shelfExample };

export function AssistantDock({
  document,
  selection,
  onProposal,
  onClose,
}: {
  document: CadDocument;
  selection?: AssistantSelection;
  onProposal: (proposal: CadProposal) => void;
  onClose: () => void;
}) {
  const [credentials, setCredentials] = useState<AssistantCredentials | null>(() => readAssistantCredentials());
  const [settings, setSettings] = useState(!credentials);
  const [messages, setMessages] = useState<AssistantMessage[]>(() => conversations.get(document.id) ?? []);
  const [text, setText] = useState('');
  const [images, setImages] = useState<AssistantImage[]>([]);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState('');
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<CadProposal | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const send = async () => {
    if (running || !credentials || (!text.trim() && !images.length)) return;
    const start = structuredClone(document);
    const user: AssistantMessage = { role: 'user', text: text.trim(), ...(images.length && { images }) };
    const transcript = [...resumeAssistantMessages(messages), user];
    const abort = new AbortController();
    controller.current = abort;
    setText('');
    setImages([]);
    setMessages(transcript);
    setRunning(true);
    setError('');
    setProposal(null);
    conversations.set(start.id, transcript);
    try {
      setActivity('Reading the open design…');
      const inspected = await inspectCadDocument(start);
      if (abort.signal.aborted) return;
      const result = await runDesignAssistant({
        base: start,
        config: credentials.config,
        key: credentials.key,
        messages: transcript,
        guide,
        examples,
        signal: abort.signal,
        context: JSON.stringify({ selection, design: compactCadReport(inspected.document, inspected.report) }),
        onMessage: message => {
          if (!mounted.current) return;
          const safe = JSON.parse(redactAssistantText(JSON.stringify(message), credentials.key)) as AssistantMessage;
          setMessages(previous => {
            const next = [...previous, safe];
            conversations.set(start.id, next);
            return next;
          });
        },
        onActivity: message => {
          if (mounted.current) setActivity(message);
        },
        check: async (source, base, signal) => {
          const checked = await checkScriptInBrowser(base, source, { signal });
          const views =
            checked.ok && credentials.config.images
              ? await Promise.all(
                  renderCadViews(checked.document, checked.parts ?? evaluateCadDocument(checked.document).parts).map(view =>
                    rasterizeAssistantView(view.svg, view.name)
                  )
                )
              : undefined;
          return { ...checked, report: compactCadReport(checked.document, checked.report), images: views };
        },
      });
      if (!mounted.current) return;
      if (result.proposal) setProposal(result.proposal);
      setActivity(
        result.status === 'stopped'
          ? 'Stopped. The design is unchanged.'
          : result.status === 'exhausted'
            ? `Stopped after ${result.checks} checks. No proposal was offered.`
            : result.proposal
              ? 'Checked proposal ready to review.'
              : 'Waiting for your reply.'
      );
    } catch (cause) {
      if (mounted.current && !abort.signal.aborted)
        setError(redactAssistantText(cause instanceof Error ? cause.message : 'The assistant could not finish.', credentials.key));
    } finally {
      if (mounted.current) {
        setRunning(false);
        if (abort.signal.aborted) setActivity('Stopped. The design is unchanged.');
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
              .filter(message => message.role !== 'tool' && message.text)
              .map((message, index) => (
                <article key={index}>
                  <strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
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
                disabled={JSON.stringify(document) !== JSON.stringify(proposal.base)}
                onClick={() => onProposal(proposal)}>
                Preview proposal
              </button>
              <button type="button" onClick={() => setProposal(null)}>
                Discard proposal
              </button>
            </div>
          )}
          <p role="status">{activity}</p>
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
                disabled={running || !credentials?.config.images || images.length >= 3}
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file)
                    void readAssistantImage(file)
                      .then(image => setImages(previous => [...previous, image]))
                      .catch(cause => setError(String(cause.message)));
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
              <button type="submit" disabled={!credentials || (!text.trim() && !images.length)}>
                Send
              </button>
            )}
          </form>
          <button
            type="button"
            disabled={running}
            onClick={() => {
              conversations.delete(document.id);
              setMessages([]);
              setProposal(null);
              setActivity('');
            }}>
            New conversation
          </button>
        </>
      )}
    </aside>
  );
}
