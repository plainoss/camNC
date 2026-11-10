import type { AssistantMessage } from './provider';

function formatResult(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Inspect observable tool activity without exposing provider payloads or image data. */
export function ActivityView({ messages, activity, running }: { messages: AssistantMessage[]; activity: string; running: boolean }) {
  const calls = messages.flatMap((message, messageIndex) =>
    (message.role === 'assistant' ? (message.calls ?? []) : []).map(call => ({
      call,
      messageIndex,
      result: messages.slice(messageIndex + 1).find(result => result.role === 'tool' && result.callId === call.id),
    }))
  );
  return (
    <details className="cad-assistant-activity">
      <summary>
        <span>Agent activity</span>
        <small>{running ? 'Working' : `${calls.length} tool ${calls.length === 1 ? 'call' : 'calls'}`}</small>
      </summary>
      <div className="cad-assistant-activity-body">
        <p>{activity || 'Tool calls and design checks will appear here as the assistant works.'}</p>
        <small>Shows tool inputs and results. Changes still require your review.</small>
        {calls.length > 0 && (
          <ol aria-label="Tool activity">
            {calls.map(({ call, messageIndex, result }, index) => (
              <li key={`${messageIndex}-${call.id}-${index}`}>
                <div className="cad-assistant-activity-step">
                  <strong>{call.name}</strong>
                  <small>{result ? 'Result received' : running ? 'In progress' : 'No result'}</small>
                </div>
                <details>
                  <summary>Inputs</summary>
                  <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
                </details>
                {result && (
                  <details>
                    <summary>Result</summary>
                    <pre>{formatResult(result.text)}</pre>
                    {!!result.images?.length && <small>{result.images.length} design views returned; image data omitted.</small>}
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}
