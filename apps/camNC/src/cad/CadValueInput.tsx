import { useContext, useRef, useState, type ComponentPropsWithoutRef, type KeyboardEvent, type Ref } from 'react';
import { cadValueHasUnit } from './valueExpressions';
import { CadVariableFieldsContext, variableDefinition, variablePrefix } from './variableFields';

type Props = ComponentPropsWithoutRef<'input'> & {
  inputRef?: Ref<HTMLInputElement>;
  unit?: 'mm' | 'deg';
  unitClassName?: string;
};

export function CadUnitSuffix({ text, unit = 'mm', className }: { text: string; unit?: 'mm' | 'deg'; className?: string }) {
  return cadValueHasUnit(text) ? null : (
    <span aria-hidden="true" className={className}>
      {unit === 'deg' ? '°' : 'mm'}
    </span>
  );
}

/** Puts text in a field as if typed, so its owner's change handler sees it. */
function typeInto(input: HTMLInputElement, text: string, caret = text.length) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.setSelectionRange(caret, caret);
}

/**
 * Keep native input/ref behavior; an uncontrolled draft only updates its adjacent unit hint. Inside the editor, `#`
 * lists the design's variables to use, with "New variable", and `#name = value` makes that variable and uses it, as
 * in the reference.
 */
export function CadValueInput({ inputRef, unit = 'mm', unitClassName, value, defaultValue, onChange, onKeyDown, onBlur, ...props }: Props) {
  const fields = useContext(CadVariableFieldsContext);
  const own = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(() => String(defaultValue ?? ''));
  const [menu, setMenu] = useState<{ start: number; typed: string; at: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The owner's handlers as of the latest render, to finish a key or leave the field once a new variable is in scope.
  const latest = useRef({ onKeyDown, onBlur });
  latest.current = { onKeyDown, onBlur };
  const options = menu
    ? [
        ...(fields?.variables ?? []).filter(variable => variable.name.toLowerCase().startsWith(menu.typed.toLowerCase())),
        { name: '', shown: 'New variable' },
      ]
    : [];
  const pick = (input: HTMLInputElement, option: { name: string }) => {
    if (!menu) return;
    const text = input.value,
      end = menu.start + 1 + menu.typed.length;
    // A new variable is typed in place, `#name = value`, and made on Enter.
    const insert = option.name ? `#${option.name}` : `#${menu.typed || 'name'} = `;
    typeInto(input, text.slice(0, menu.start) + insert + text.slice(end), menu.start + insert.length);
    if (!option.name && !menu.typed) input.setSelectionRange(menu.start + 1, menu.start + 5);
    setMenu(null);
  };
  /** Makes the variable a field's `#name = value` names, and leaves `#name` in the field. */
  const define = (input: HTMLInputElement) => {
    const definition = fields && variableDefinition(input.value);
    if (!definition) return false;
    const refused = fields.define(definition.name, definition.expression);
    setProblem(refused);
    if (!refused) typeInto(input, `#${definition.name}`);
    return true;
  };
  const setRefs = (element: HTMLInputElement | null) => {
    own.current = element;
    if (typeof inputRef === 'function') inputRef(element);
    else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = element;
  };
  return (
    <>
      <input
        {...props}
        ref={setRefs}
        value={value}
        defaultValue={defaultValue}
        aria-invalid={problem ? true : props['aria-invalid']}
        title={problem ?? props.title}
        aria-expanded={fields ? !!menu : undefined}
        onChange={event => {
          setDraft(event.currentTarget.value);
          setProblem(null);
          if (fields) {
            const prefix = variablePrefix(
              event.currentTarget.value,
              event.currentTarget.selectionStart ?? event.currentTarget.value.length
            );
            setMenu(prefix ? { ...prefix, at: 0 } : null);
          }
          onChange?.(event);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          const input = event.currentTarget;
          if (menu && options.length) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              event.stopPropagation();
              const step = event.key === 'ArrowDown' ? 1 : options.length - 1;
              return setMenu({ ...menu, at: (menu.at + step) % options.length });
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              event.stopPropagation();
              return pick(input, options[menu.at]!);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              return setMenu(null);
            }
          }
          if (event.key === 'Enter' && variableDefinition(input.value)) {
            event.preventDefault();
            event.stopPropagation();
            // Once the variable is in the design, Enter applies `#name` as the field would any value.
            if (define(input)) {
              const enter = {
                key: 'Enter',
                currentTarget: input,
                target: input,
                nativeEvent: { isComposing: false, keyCode: 13 },
                preventDefault: () => {},
                stopPropagation: () => {},
              } as unknown as KeyboardEvent<HTMLInputElement>;
              requestAnimationFrame(() => requestAnimationFrame(() => latest.current.onKeyDown?.(enter)));
            }
            return;
          }
          onKeyDown?.(event);
        }}
        onBlur={event => {
          setMenu(null);
          const input = event.currentTarget;
          // Leaving the field makes the variable too, then the field takes `#name` as it would on leaving.
          if (variableDefinition(input.value) && define(input)) {
            requestAnimationFrame(() =>
              requestAnimationFrame(() => latest.current.onBlur?.({ ...event, currentTarget: input, target: input }))
            );
            return;
          }
          onBlur?.(event);
        }}
      />
      {menu && options.length > 0 && (
        <ul
          className="cad-variable-menu"
          role="listbox"
          aria-label="Variables"
          style={(() => {
            const box = own.current?.getBoundingClientRect();
            return box ? { left: box.left, top: box.bottom + 2, minWidth: Math.max(160, box.width) } : undefined;
          })()}>
          {options.map((option, index) => (
            <li
              key={option.name || 'new'}
              role="option"
              aria-selected={index === menu.at}
              onPointerDown={event => {
                event.preventDefault();
                if (own.current) pick(own.current, option);
              }}>
              {option.name ? (
                <>
                  <span>#{option.name}</span>
                  <small>{option.shown}</small>
                </>
              ) : (
                <span>{option.shown}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <span role="alert" className="cad-variable-field-problem">
          {problem}
        </span>
      )}
      <CadUnitSuffix text={value === undefined ? draft : String(value)} unit={unit} className={unitClassName} />
    </>
  );
}
