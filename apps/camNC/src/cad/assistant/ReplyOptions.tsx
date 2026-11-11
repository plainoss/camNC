import type { AssistantChoiceSketch } from './choiceSketch';

/** The text is the answer; optional sketches only illustrate the choice. */
export function ReplyOptions({
  question,
  disabled,
  onReply,
}: {
  question: { question?: string; choices: string[]; sketches?: AssistantChoiceSketch[] };
  disabled: boolean;
  onReply: (choice: string) => void;
}) {
  return (
    <div className="cad-assistant-replies" role="group" aria-label="Suggested replies">
      {question.question && <p className="cad-assistant-reply-question">{question.question}</p>}
      {question.choices.map((choice, index) => {
        const sketch = question.sketches?.find(item => item.choiceIndex === index);
        const colon = choice.indexOf(':');
        const hasTitle = colon > 0 && colon <= 50 && !!choice.slice(colon + 1).trim();
        return (
          <button
            type="button"
            className="cad-assistant-option"
            key={choice}
            aria-label={choice}
            disabled={disabled}
            onClick={() => onReply(choice)}>
            {sketch && (
              <span className="cad-assistant-option-visual" aria-hidden="true">
                <svg
                  className="cad-assistant-option-sketch"
                  viewBox="0 0 100 100"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round">
                  {sketch.shapes.map(({ kind, coords: [x, y, a, b] }, shapeIndex) =>
                    kind === 'line' ? (
                      <line key={shapeIndex} x1={x} y1={y} x2={a} y2={b} />
                    ) : kind === 'rect' ? (
                      <rect key={shapeIndex} x={x} y={y} width={a} height={b} rx="1" />
                    ) : (
                      <ellipse key={shapeIndex} cx={x} cy={y} rx={a} ry={b} />
                    )
                  )}
                </svg>
                <small>Illustration</small>
              </span>
            )}
            <span className="cad-assistant-option-copy">
              <strong>{hasTitle ? choice.slice(0, colon) : choice}</strong>
              {hasTitle && <span>{choice.slice(colon + 1).trim()}</span>}
            </span>
            <span className="cad-assistant-option-arrow" aria-hidden="true">
              →
            </span>
          </button>
        );
      })}
    </div>
  );
}
