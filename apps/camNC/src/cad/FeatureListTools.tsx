import { featureDependencies, type CadDocument } from '@wbcnc/cad';
import { useState } from 'react';
import { kFeatureFilterHelp, setFeatureFilter, useFeatureFilter } from './featureFilter';

/** "Filter by name or type" above the Feature list; while it has the keyboard, the syntax it takes. */
export function FeatureFilterBox() {
  const text = useFeatureFilter();
  const [focused, setFocused] = useState(false);
  return (
    <div className="cad-feature-filter">
      <input
        type="search"
        aria-label="Filter by name or type"
        placeholder="Filter by name or type"
        aria-describedby={focused ? 'cad-feature-filter-help' : undefined}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={event => setFeatureFilter(event.target.value)}
        onKeyDown={event => {
          // Typing stays in the box: the editor's shortcuts don't take its letters.
          event.stopPropagation();
          if (event.key === 'Escape') setFeatureFilter('');
        }}
      />
      {focused && (
        <div id="cad-feature-filter-help" role="note" className="cad-feature-filter-help">
          <p>Filter by name or type, or with:</p>
          <dl>
            {kFeatureFilterHelp.map(([syntax, meaning]) => (
              <div key={syntax}>
                <dt>{syntax}</dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

/**
 * "Dependencies of Extrude 1": what the entry builds on above it, the entry itself between arrows, and what builds on
 * it below.
 */
export function FeatureDependenciesPanel({
  document,
  entryKey,
  label,
  order,
  onClose,
}: {
  document: CadDocument;
  entryKey: string;
  /** The Feature list's rows, by key, in its order: each list follows it. */
  order: string[];
  /** The name each entry has in the Feature list, by key. */
  label: (key: string) => string;
  onClose: () => void;
}) {
  const found = featureDependencies(document, entryKey);
  const inOrder = (keys: string[]) => order.filter(key => keys.includes(key));
  const parents = inOrder(found.parents),
    children = inOrder(found.children);
  const title = `Dependencies of ${label(entryKey)}`;
  const list = (name: string, keys: string[]) => (
    <ul aria-label={name}>
      {keys.length ? keys.map(key => <li key={key}>{label(key)}</li>) : <li className="cad-feature-dependencies-none">None</li>}
    </ul>
  );
  return (
    <section className="cad-feature-dependencies" role="dialog" aria-label={title}>
      <header>
        <h3>{title}</h3>
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {list('Depends on', parents)}
      <p className="cad-feature-dependencies-arrow" aria-hidden="true">
        ↑
      </p>
      <p className="cad-feature-dependencies-self">{label(entryKey)}</p>
      <p className="cad-feature-dependencies-arrow" aria-hidden="true">
        ↓
      </p>
      {list('Used by', children)}
    </section>
  );
}
