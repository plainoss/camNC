import { useState } from 'react';
import type { AssistantChoiceSketch } from './choiceSketch';
import { answerQuestionFields, type AssistantQuestionField } from './questionFields';
import type { AssistantRequirements } from './requirements';

/** The text is the answer; optional sketches only illustrate the choice. */
export function ReplyOptions({
  question,
  disabled,
  onReply,
}: {
  question: { question?: string; choices: string[]; sketches?: AssistantChoiceSketch[]; fields?: AssistantQuestionField[] };
  disabled: boolean;
  /** Typed field answers come with the requirements they confirm. */
  onReply: (choice: string, requirements?: AssistantRequirements) => void;
}) {
  const fields = question.fields ?? [];
  const [values, setValues] = useState<Record<string, number | undefined>>(() =>
    Object.fromEntries(fields.map(field => [field.name, field.value]))
  );
  const answer = answerQuestionFields(fields, values);
  return (
    <div className="cad-assistant-replies" role="group" aria-label="Suggested replies">
      {question.question && <p className="cad-assistant-reply-question">{question.question}</p>}
      {fields.length > 0 && (
        <form
          className="cad-assistant-fields"
          aria-label="Answer with values"
          onSubmit={event => {
            event.preventDefault();
            if (answer.text) onReply(answer.text, answer.requirements);
          }}>
          <div>
            {fields.map(field => (
              <label key={field.name}>
                {field.label}
                <span>
                  <input
                    type="number"
                    min={field.unit === 'count' ? 0 : 0.1}
                    step={field.unit === 'count' ? 1 : 'any'}
                    disabled={disabled}
                    value={values[field.name] ?? ''}
                    onChange={event =>
                      setValues(previous => ({ ...previous, [field.name]: event.target.value ? Number(event.target.value) : undefined }))
                    }
                  />
                  {field.unit === 'mm' && <small>mm</small>}
                </span>
              </label>
            ))}
          </div>
          <button type="submit" className="cad-assistant-primary" disabled={disabled || !answer.text}>
            Use these values
          </button>
        </form>
      )}
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
