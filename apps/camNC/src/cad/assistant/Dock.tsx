import { useEffect, useRef, useState } from 'react';
import { evaluateCadDocument, type CadDocument } from '@wbcnc/cad';
import { compactCadReport, inspectCadDocument, renderCadViews } from '@wbcnc/cad-script';
import type { CadProposal } from '@wbcnc/cad-editor/proposal';
import { readAssistantCredentials, redactAssistantText, type AssistantCredentials } from './keyStore';
import type { AssistantImage, AssistantMessage } from './provider';
import { ProviderSettings } from './ProviderSettings';
import { readAssistantImage, rasterizeAssistantView } from './images';
import { assistantQuestion, resumeAssistantMessages, runDesignAssistant } from './loop';
import { ActivityView } from './ActivityView';
import { checkScriptInBrowser } from './scriptCheck';
import guide from '../../../../../packages/cad-script/README.md?raw';
import cupboardExample from '../../../../../packages/cad-script/examples/cupboard.cad.ts?raw';
import plateExample from '../../../../../packages/cad-script/examples/plate.cad.ts?raw';
import trayExample from '../../../../../packages/cad-script/examples/tray.cad.ts?raw';
import shelfExample from '../../../../../packages/cad-script/examples/shelf-side.cad.ts?raw';
import './dock.css';
import type { AssistantSelection } from './selection';

const conversations = new Map<string, AssistantMessage[]>();
const starters = [
  {
    title: 'Build a cupboard',
    detail: 'Plan the size, shelves and joinery',
    prompt: 'Help me design a cupboard. Ask me about dimensions, shelves and joinery before building.',
  },
  {
    title: 'Design a tray',
    detail: 'A small project, made your way',
    prompt: 'Help me design a wooden tray. Ask me about its size and construction first.',
  },
  {
    title: 'Review this design',
    detail: 'Explore dimensions and improvements',
    prompt: 'Review the open design and suggest improvements. Ask before making changes.',
  },
];
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
  const [messages, setMessages] = useState<AssistantMessage[]>(() => conversations.get(document.id) ?? []);
  const [text, setText] = useState('');
  const [images, setImages] = useState<AssistantImage[]>([]);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState('');
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<CadProposal | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const attachment = useRef<HTMLInputElement>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const latest = messages.at(-1);
  const questionMessage = messages.findLast(message => message.role === 'assistant');
  const question = latest?.role !== 'user' && questionMessage ? assistantQuestion(questionMessage) : undefined;
  useEffect(() => {
    if (messages.length) transcriptEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, activity]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const send = async (reply = text) => {
    if (running || !credentials || (!reply.trim() && !images.length)) return;
    const start = structuredClone(document);
    const user: AssistantMessage = { role: 'user', text: reply.trim(), ...(images.length && { images }) };
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
        <div className="cad-assistant-heading">
          <span className="cad-assistant-eyebrow">PART STUDIO · DESIGN PARTNER</span>
          <h2>Design assistant</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close assistant">
          Close
        </button>
      </header>
      <nav className="cad-assistant-tabs" aria-label="Assistant views">
        <button type="button" aria-pressed={!settings} disabled={running} onClick={() => setSettings(false)}>
          Messages
        </button>
        <button type="button" aria-pressed={settings} disabled={running} onClick={() => setSettings(true)}>
          Connection
        </button>
      </nav>
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
            {!messages.length && (
              <div className="cad-assistant-empty">
                <span className="cad-assistant-eyebrow">FROM IDEA TO WORKSHOP</span>
                <h3>What shall we make?</h3>
                <p>Shape a new piece or refine your design. Start with an idea, a question or a reference.</p>
                <div className="cad-assistant-starters">
                  {starters.map(starter => (
                    <button
                      type="button"
                      key={starter.title}
                      onClick={() => {
                        setText(starter.prompt);
                        composer.current?.focus();
                      }}>
                      <strong>{starter.title}</strong>
                      <span>{starter.detail}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages
              .filter(message => message.role !== 'tool' && (message.text || assistantQuestion(message) || message.images?.length))
              .map((message, index) => (
                <article key={index} className="cad-assistant-message" data-role={message.role}>
                  <strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
                  {message.text && <p>{message.text}</p>}
                  {assistantQuestion(message) && assistantQuestion(message)?.question !== message.text && (
                    <p>{assistantQuestion(message)?.question}</p>
                  )}
                  {message.images?.map((image, i) => (
                    <img key={i} src={`data:${image.mediaType};base64,${image.data}`} alt={image.name} />
                  ))}
                </article>
              ))}
            <div ref={transcriptEnd} />
          </div>
          {question && !proposal && (
            <div className="cad-assistant-replies" role="group" aria-label="Suggested replies">
              {question.choices.map(choice => (
                <button type="button" key={choice} disabled={running} onClick={() => void send(choice)}>
                  {choice}
                </button>
              ))}
            </div>
          )}
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
              <button type="button" onClick={() => setProposal(null)}>
                Discard proposal
              </button>
            </div>
          )}
          <p className="cad-assistant-status" data-running={running} role="status">
            {activity}
          </p>
          <ActivityView messages={messages} activity={activity} running={running} />
          {error && <p role="alert">{error}</p>}
          <form
            className="cad-assistant-composer"
            onSubmit={event => {
              event.preventDefault();
              void send();
            }}>
            <label>
              Message
              <textarea
                ref={composer}
                placeholder="Describe your idea, or choose a suggestion…"
                value={text}
                onChange={event => setText(event.target.value)}
                disabled={running}
                rows={3}
              />
            </label>
            <div className="cad-assistant-composer-actions">
              <button
                type="button"
                className="cad-assistant-attach"
                aria-label="Add reference image"
                title={credentials?.config.images ? 'Add reference image' : 'Enable image support in Connection'}
                disabled={running || !credentials?.config.images || images.length >= 3}
                onClick={() => attachment.current?.click()}>
                <span aria-hidden="true">＋</span> Attach
              </button>
              <small>PNG, JPG, WebP or GIF · up to 3</small>
            </div>
            <input
              ref={attachment}
              type="file"
              hidden
              aria-label="Reference image"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={running || !credentials?.config.images || images.length >= 3}
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file)
                  void readAssistantImage(file)
                    .then(image => setImages(previous => [...previous, image].slice(0, 3)))
                    .catch(cause => setError(String(cause.message)));
              }}
            />
            {!credentials?.config.images && <small>Enable image support in Connection to attach a reference.</small>}
            {images.map((image, index) => (
              <div key={index} className="cad-assistant-attachment">
                <img src={`data:${image.mediaType};base64,${image.data}`} alt={image.name} />
                <span>{image.name}</span>
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
              <button type="submit" className="cad-assistant-primary" disabled={!credentials || (!text.trim() && !images.length)}>
                Send
              </button>
            )}
          </form>
          <button
            className="cad-assistant-footer"
            type="button"
            disabled={running}
            onClick={() => {
              conversations.delete(document.id);
              setMessages([]);
              setProposal(null);
              setActivity('');
              setText('');
              setImages([]);
              setError('');
            }}>
            New conversation
          </button>
        </>
      )}
    </aside>
  );
}
