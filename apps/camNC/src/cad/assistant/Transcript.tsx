import type { RefObject } from 'react';
import type { CadProposal } from '@wbcnc/cad-editor/proposal';
import type { AssistantMessage } from './provider';
import { assistantQuestion } from './loop';
import { ReplyOptions } from './ReplyOptions';
import { WorkSteps, conversationItems } from './WorkSteps';
import type { AssistantRequirements } from './requirements';

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

/** The conversation: messages, the work between them, the open question and the checked proposal, in reading order. */
export function Transcript({
  messages,
  running,
  activity,
  readingImage,
  proposal,
  staleProposal,
  disabled,
  replyAnchor,
  transcriptEnd,
  onStarter,
  onReply,
  onReview,
  onDiscard,
}: {
  messages: AssistantMessage[];
  running: boolean;
  activity: string;
  readingImage: boolean;
  proposal: CadProposal | null;
  staleProposal: boolean;
  disabled?: boolean;
  replyAnchor: RefObject<HTMLDivElement | null>;
  transcriptEnd: RefObject<HTMLDivElement | null>;
  onStarter: (prompt: string) => void;
  onReply: (reply: string, requirements?: AssistantRequirements) => void;
  onReview: () => void;
  onDiscard: () => void;
}) {
  const latest = messages.at(-1);
  const questionMessage = messages.findLast(message => message.role === 'assistant');
  const question = latest?.role !== 'user' && questionMessage ? assistantQuestion(questionMessage) : undefined;
  const items = conversationItems(messages);
  const lastWork = items.findLastIndex(item => item.kind === 'work');
  const lastUser = items.findLastIndex(item => item.kind === 'message' && item.message.role === 'user');
  // The newest turn shows the live activity, even before its first tool call arrives.
  const workingWithoutSteps = running && lastWork < lastUser;
  return (
    <div className="cad-assistant-messages" role="log" aria-label="Conversation">
      {!messages.length && (
        <div className="cad-assistant-empty">
          <span className="cad-assistant-eyebrow">FROM IDEA TO WORKSHOP</span>
          <h3>What shall we make?</h3>
          <p>Shape a new piece or refine your design. Start with an idea, a question or a reference.</p>
          <div className="cad-assistant-starters">
            {starters.map(starter => (
              <button type="button" key={starter.title} onClick={() => onStarter(starter.prompt)}>
                <strong>{starter.title}</strong>
                <span>{starter.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {items.map((item, index) => {
        if (item.kind === 'work')
          return <WorkSteps key={index} steps={item.steps} running={running && index === lastWork && lastWork > lastUser} activity={activity} />;
        const { message } = item;
        const asked = assistantQuestion(message);
        // The open question is shown once, in the reply card below.
        if (question && message === questionMessage && !message.text && !message.images?.length) return null;
        if (!message.text && !asked && !message.images?.length) return null;
        return (
          <article key={index} className="cad-assistant-message" data-role={message.role} data-event={message.event || undefined}>
            <strong>{message.event ? 'Design' : message.role === 'user' ? 'You' : 'Assistant'}</strong>
            {message.text && <p>{message.text}</p>}
            {!(question && message === questionMessage) && asked && asked.question !== message.text && <p>{asked.question}</p>}
            {message.images?.map((image, i) => (
              <img key={i} src={`data:${image.mediaType};base64,${image.data}`} alt={image.name} />
            ))}
          </article>
        );
      })}
      {workingWithoutSteps && <WorkSteps steps={[]} running activity={activity} />}
      {question && (
        <div ref={replyAnchor}>
          <ReplyOptions key={questionMessage && messages.indexOf(questionMessage)} question={question} disabled={running || readingImage} onReply={onReply} />
        </div>
      )}
      {proposal && (
        <div className="cad-assistant-proposal">
          <strong>Checked design proposal</strong>
          <p>Review the changes, lost cuts and warnings before applying.</p>
          {staleProposal && (
            <p>The design has changed. You can review this proposal, but it cannot be applied. Ask again to check a new proposal.</p>
          )}
          <div>
            <button type="button" className="cad-assistant-primary" disabled={disabled || running} onClick={onReview}>
              Review proposal
            </button>
            <button type="button" onClick={onDiscard}>
              Discard proposal
            </button>
          </div>
          {disabled && <p>Complete the current edit before reviewing this proposal.</p>}
        </div>
      )}
      <p className="cad-assistant-status" data-running={running} role="status">
        {proposal && !running && (staleProposal || !question)
          ? staleProposal
            ? 'Proposal out of date. It cannot be applied; ask again to check a new proposal.'
            : 'Checked proposal ready to review.'
          : running
            ? ''
            : activity}
      </p>
      <div ref={transcriptEnd} />
    </div>
  );
}
