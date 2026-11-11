import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluateCadDocument, type CadDocument } from '@wbcnc/cad';
import { compactCadReport, inspectCadDocument, renderCadViews } from '@wbcnc/cad-script';
import type { CadProposal } from '@wbcnc/cad-editor/proposal';
import { readAssistantCredentials, redactAssistantText, type AssistantCredentials } from './keyStore';
import type { AssistantImage, AssistantMessage } from './provider';
import { ProviderSettings } from './ProviderSettings';
import { readAssistantImage, rasterizeAssistantView } from './images';
import { assistantQuestion, resumeAssistantMessages, runDesignAssistant } from './loop';
import { ActivityView } from './ActivityView';
import { ReplyOptions } from './ReplyOptions';
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
import pebbleExample from '../../../../../packages/cad-script/examples/pebble-tray.cad.ts?raw';
import './dock.css';
import type { AssistantSelection } from './selection';
import { holdPending } from '@/lib/settled';

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
const examples = {
  cupboard: cupboardExample,
  plate: plateExample,
  tray: trayExample,
  'shelf-side': shelfExample,
  'pebble-tray': pebbleExample,
};

export function AssistantDock({
  document,
  selection,
  disabled,
  onProposal,
  proposal,
  onCheckedProposal,
  onDiscardProposal,
  onClose,
}: {
  document: CadDocument;
  selection?: AssistantSelection;
  disabled?: boolean;
  onProposal: (proposal: CadProposal) => void;
  proposal: CadProposal | null;
  onCheckedProposal: (proposal: CadProposal | null) => void;
  onDiscardProposal: () => void;
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
  const staleProposal = !!proposal && JSON.stringify(document) !== JSON.stringify(proposal.base);
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
        if (next.at(-1)?.proposalOutcome) {
          onCheckedProposal(null);
          setActivity(next.at(-1)?.proposalOutcome === 'applied' ? 'Proposal applied.' : 'Proposal discarded. The design is unchanged.');
        }
      }),
    [document.id, onCheckedProposal]
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
  const composer = useRef<HTMLTextAreaElement>(null);
  const attachment = useRef<HTMLInputElement>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const replyAnchor = useRef<HTMLDivElement>(null);
  const latest = messages.at(-1);
  const questionMessage = messages.findLast(message => message.role === 'assistant');
  const question = useMemo(
    () => (latest?.role !== 'user' && questionMessage ? assistantQuestion(questionMessage) : undefined),
    [latest, questionMessage]
  );
  useEffect(() => {
    if (question) replyAnchor.current?.scrollIntoView({ block: 'start' });
    else if (messages.length) transcriptEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, activity, question]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const send = async (reply = text) => {
    if (running || readingImage || !credentials || (!reply.trim() && !images.length)) return;
    const start = structuredClone(document);
    const user: AssistantMessage = { role: 'user', text: reply.trim(), ...(images.length && { images }) };
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
    writeConversation(start.id, transcript);
    const turn = holdPending('assistant');
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
      if (result.proposal && !abort.signal.aborted) onCheckedProposal(result.proposal);
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
      turn();
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
              .filter(message => !(question && message === questionMessage && !message.text && !message.images?.length))
              .map((message, index) => (
                <article key={index} className="cad-assistant-message" data-role={message.role}>
                  <strong>{message.event ? 'Design' : message.role === 'user' ? 'You' : 'Assistant'}</strong>
                  {message.text && <p>{message.text}</p>}
                  {!(question && message === questionMessage) &&
                    assistantQuestion(message) &&
                    assistantQuestion(message)?.question !== message.text && <p>{assistantQuestion(message)?.question}</p>}
                  {message.images?.map((image, i) => (
                    <img key={i} src={`data:${image.mediaType};base64,${image.data}`} alt={image.name} />
                  ))}
                </article>
              ))}
            {question && (
              <div ref={replyAnchor}>
                <ReplyOptions question={question} disabled={running || readingImage} onReply={choice => void send(choice)} />
              </div>
            )}
            <div ref={transcriptEnd} />
          </div>
          {selection && <small>Selection: {selection.name}</small>}
          {proposal && (
            <div className="cad-assistant-proposal">
              <strong>Checked design proposal</strong>
              <p>Review the changes, lost cuts and warnings before applying.</p>
              {staleProposal && (
                <p>The design has changed. You can review this proposal, but it cannot be applied. Ask again to check a new proposal.</p>
              )}
              <button type="button" className="cad-assistant-primary" disabled={disabled || running} onClick={() => onProposal(proposal)}>
                Review proposal
              </button>
              {disabled && <p>Complete the current edit before reviewing this proposal.</p>}
              <button type="button" onClick={onDiscardProposal}>
                Discard proposal
              </button>
            </div>
          )}
          <p className="cad-assistant-status" data-running={running} role="status">
            {proposal && !running && (staleProposal || !question)
              ? staleProposal
                ? 'Proposal out of date. It cannot be applied; ask again to check a new proposal.'
                : 'Checked proposal ready to review.'
              : activity}
          </p>
          <ActivityView messages={messages} activity={activity} running={running} />
          <RunSettings value={runSettings} usage={usage} disabled={running} onChange={setRunSettings} />
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
                aria-keyshortcuts="Control+Enter Meta+Enter"
                onKeyDown={event => {
                  if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey) return;
                  // IME confirmation and a held shortcut must not send partial or duplicate messages.
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  event.preventDefault();
                  if (!event.repeat) event.currentTarget.form?.requestSubmit();
                }}
                disabled={running}
                rows={2}
              />
            </label>
            <small className="cad-assistant-shortcut">⌘ / Ctrl + Enter to send · Enter for a new line</small>
            <input
              ref={attachment}
              type="file"
              hidden
              aria-label="Reference image"
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
            <div className="cad-assistant-composer-actions">
              <button
                type="button"
                className="cad-assistant-attach"
                aria-label="Add reference image"
                title={credentials?.config.images ? 'Add reference image' : 'Enable image support in Connection'}
                disabled={running || readingImage || !credentials?.config.images || images.length >= 3}
                onClick={() => attachment.current?.click()}>
                <span aria-hidden="true">＋</span> Attach
              </button>
              <small>PNG, JPG, WebP or GIF · up to 3</small>
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
                <button
                  type="submit"
                  className="cad-assistant-primary"
                  disabled={readingImage || !credentials || (!text.trim() && !images.length)}>
                  Send
                </button>
              )}
            </div>
          </form>
          <button
            className="cad-assistant-footer"
            type="button"
            disabled={running}
            onClick={() => {
              writeConversation(document.id, []);
              setActivity('');
              setUsage(null);
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
