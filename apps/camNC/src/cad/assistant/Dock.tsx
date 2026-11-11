import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluateCadDocument, type CadDocument } from '@wbcnc/cad';
import { compactCadReport, inspectCadDocument } from '@wbcnc/cad-script';
import type { CadProposal } from '@wbcnc/cad-editor/proposal';
import { readAssistantCredentials, redactAssistantText, type AssistantCredentials } from './keyStore';
import type { AssistantImage, AssistantMessage } from './provider';
import { ProviderSettings } from './ProviderSettings';
import { rasterizeAssistantView } from './images';
import { assistantQuestion, resumeAssistantMessages, runDesignAssistant } from './loop';
import { BriefChips } from './BriefChips';
import { Composer } from './Composer';
import { Transcript } from './Transcript';
import { connectionLabel } from './connectionPresets';
import type { AssistantRequirements } from './requirements';
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
import { Requirements } from './RequirementSettings';
import { readRequirements, confirmRequirements, subscribeRequirements, bindProposalRequirements } from './requirementStore';
import { renderAssistantViews } from './designViews';
import { finalizeBrowserCandidate } from './finalizeCandidate';
import { checkAssistantSvg } from './svgCheck';
import { svgAssetsForDocument } from '../svg/svgAssets';
import { holdPending } from '@/lib/settled';

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
  const [view, setView] = useState<'chat' | 'connection' | 'settings'>(credentials ? 'chat' : 'connection');
  const [messages, setMessages] = useState<AssistantMessage[]>(() => readConversation(document.id));
  const [runSettings, setRunSettings] = useState<AssistantRunSettings>({ limits: {} });
  const [usage, setUsage] = useState<AssistantRunUsage | null>(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState<AssistantImage[]>([]);
  const [readingImage, setReadingImage] = useState(false);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(() => readRequirements(document.id));
  useEffect(
    () =>
      subscribeRequirements(document.id, () => {
        setConfirmed(readRequirements(document.id));
        onCheckedProposal(null);
        controller.current?.abort();
      }),
    [document.id, onCheckedProposal]
  );
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
    // Read here, not from state: a typed answer confirms requirements in the same click that sends it.
    const brief = readRequirements(document.id);
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
        requirements: brief.requirements,
        svg: {
          assets: svgAssetsForDocument(start.id).list(),
          check: (input, signal, options) => checkAssistantSvg(start, input, signal, options.views),
        },
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
          const checked = await checkScriptInBrowser(base, source, { signal, toolpaths: false });
          if (signal.aborted) return checked;
          const views =
            checked.ok && credentials.config.images && options?.views
              ? await Promise.all(
                  renderAssistantViews(checked.document, checked.parts ?? evaluateCadDocument(checked.document).parts, options?.views).map(
                    view =>
                      signal.aborted
                        ? Promise.reject(new DOMException('Stopped', 'AbortError'))
                        : rasterizeAssistantView(view.svg, view.name)
                  )
                )
              : undefined;
          const detailReport = compactCadReport(checked.document, checked.report);
          return {
            ...checked,
            trustedReport: checked.report,
            detailReport,
            report: summarizeAssistantReport(detailReport, { partId: selection?.partId, partName: selection?.name }),
            images: views,
          };
        },
        finalize: async (candidate, signal) => {
          if (!candidate.trustedReport) throw new Error('Missing trusted geometry check.');
          const checked = await finalizeBrowserCandidate(
            { ...candidate, report: candidate.trustedReport, parts: candidate.parts ?? [] },
            signal
          );
          const detailReport = compactCadReport(checked.document, checked.report);
          return {
            ...checked,
            trustedReport: checked.report,
            detailReport,
            report: summarizeAssistantReport(detailReport, { partId: selection?.partId, partName: selection?.name }),
          };
        },
      });
      if (!mounted.current) return;
      if (result.proposal && !abort.signal.aborted) {
        bindProposalRequirements(result.proposal, brief.revision);
        onCheckedProposal(result.proposal);
      }
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
  const removeRequirement = (key: string) => {
    const next = { ...readRequirements(document.id).requirements };
    delete (next as Record<string, unknown>)[key];
    confirmBrief(next);
  };
  const confirmBrief = (value: AssistantRequirements) => {
    confirmRequirements(document.id, value);
    recordAssistantEvent(
      document.id,
      `Confirmed application requirements: ${JSON.stringify(value)}. These supersede earlier application requirements.`
    );
  };
  const newConversation = () => {
    writeConversation(document.id, []);
    setActivity('');
    setUsage(null);
    setText('');
    setImages([]);
    setError('');
    setView('chat');
  };
  const menuItem = (label: string, action: () => void) => (
    <button
      type="button"
      disabled={running}
      onClick={event => {
        event.currentTarget.closest('details')?.removeAttribute('open');
        action();
      }}>
      {label}
    </button>
  );
  return (
    <aside className="cad-assistant-dock" aria-label="Design assistant" onKeyDown={event => event.stopPropagation()}>
      <header>
        <h2>Design assistant</h2>
        {usage?.costUsd != null && (
          <span className="cad-assistant-cost" title={`Last turn: ${usage.calls} requests, ${usage.checks} checks`}>
            ${usage.costUsd.toFixed(3)}
          </span>
        )}
        <details className="cad-assistant-menu">
          <summary aria-label="Assistant menu">⋯</summary>
          {/* A disclosure of buttons, not an ARIA menu: it has no menu keyboard model, and toolbars own role="menu". */}
          <div>
            {menuItem('New conversation', newConversation)}
            {menuItem(credentials ? `Connection · ${connectionLabel(credentials.config)}` : 'Connection', () => setView('connection'))}
            {menuItem('Usage, limits and brief', () => setView('settings'))}
          </div>
        </details>
        <button type="button" className="cad-assistant-close" onClick={onClose} aria-label="Close assistant">
          ✕
        </button>
      </header>
      {view !== 'chat' && credentials && (
        <button type="button" className="cad-assistant-back" disabled={running} onClick={() => setView('chat')}>
          ← Conversation
        </button>
      )}
      {view === 'connection' || !credentials ? (
        <ProviderSettings
          value={credentials}
          onSave={value => {
            setCredentials(value);
            if (value) setView('chat');
          }}
        />
      ) : view === 'settings' ? (
        <div className="cad-assistant-settings-view">
          <RunSettings value={runSettings} usage={usage} disabled={running} onChange={setRunSettings} />
          <Requirements value={confirmed.requirements} disabled={running} onConfirm={confirmBrief} />
        </div>
      ) : (
        <>
          <BriefChips value={confirmed.requirements} disabled={running} onRemove={removeRequirement} onEdit={() => setView('settings')} />
          <Transcript
            messages={messages}
            running={running}
            activity={activity}
            readingImage={readingImage}
            proposal={proposal}
            staleProposal={staleProposal}
            disabled={disabled}
            replyAnchor={replyAnchor}
            transcriptEnd={transcriptEnd}
            onStarter={prompt => {
              setText(prompt);
              composer.current?.focus();
            }}
            onReply={(reply, requirements) => {
              if (requirements && Object.keys(requirements).length)
                confirmBrief({ ...readRequirements(document.id).requirements, ...requirements });
              void send(reply);
            }}
            onReview={() => proposal && onProposal(proposal)}
            onDiscard={onDiscardProposal}
          />
          {error && <p role="alert">{error}</p>}
          <Composer
            composer={composer}
            text={text}
            onText={setText}
            images={images}
            onImages={update => {
              if (mounted.current) setImages(update);
            }}
            imagesSupported={!!credentials?.config.images}
            readingImage={readingImage}
            onReadingImage={value => {
              if (mounted.current) setReadingImage(value);
            }}
            context={selection ? `⬚ ${selection.name}` : '⬚ Whole studio'}
            running={running}
            canSend={!readingImage && !!credentials && (!!text.trim() || !!images.length)}
            onSend={() => void send()}
            onStop={() => {
              controller.current?.abort();
              setActivity('Stopping…');
            }}
            onError={message => {
              if (mounted.current) setError(message);
            }}
          />
        </>
      )}
    </aside>
  );
}
