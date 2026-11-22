# Application translations

The camNC application (including its desktop frontend) supports English and French. This does not localize the marketing website.

The **Language** selector is in the app menu, below the camera selector. The initial language follows the first supported browser/system preference. An explicit choice is stored locally as `camnc.language`, separately from machine settings, account sync and backups. English is the fallback. Catalogs are bundled; no translation service or internet connection is needed.

## Applying a language

Choose a language, save any unfinished work, then select **Apply and reload**. Reloading is explicit because some menus and metadata are initialized at module load. It does not send a controller command. Application of the language is refused while a connected controller reports a state other than `Idle`, or has not yet reported a state. Machine state checks do not prove physical safety.

## Adding or updating messages

`@wbcnc/i18n` provides `t(message, values)` for React render code and ordinary TypeScript, including error and event handlers. Use it for application text, accessible names, tooltips and explanatory errors. Pass complete sentences and named interpolation parameters, not concatenated translated words:

```ts
import { t } from '@wbcnc/i18n';
const message = t('Could not run {{value1}}', { value1: file.name });
```

React handles HTML escaping. Catalog strings are plain text: never use them as HTML. Keep user input, filenames, controller state identifiers, protocol commands, AI tool schemas, parameter keys and machine units outside translation. Original controller console lines are preserved; their explanatory descriptions and alarm guidance are localized in the presentation layer. Error text from external libraries or firmware that has no catalog entry remains available in its original form.

Run `pnpm i18n:extract` after adding calls, translate the new entries in `packages/i18n/src/locales/fr.json`, and run `pnpm i18n:check`. The check verifies catalog synchronization, the exact set of interpolation placeholders, and untranslated literal branches inside conditional display parameters. Translate those branches explicitly; leave their conditions and data identifiers unchanged. Explicit translation calls are the source of the catalog; standard FluidNC error/alarm description tables are also extracted for display. Do not modify the transport library to translate raw controller traffic.

Use i18next's `count` and `_one`/`_other` entries for counts (see `partCount`); French and English have different plural rules for zero. Avoid appending English plural suffixes in new messages. Existing rich-text fragments remain separate where JSX embeds controls or formatted values; new multi-part sentences should be designed as a single translatable message whenever possible.

To add a language, add its code and native name to `languages`, bundle its resource in the i18next initialization, and supply a complete catalog. Extend the catalog checker and tests to include it. No network detector, remote catalog loader or credentials are required.

## Validation

`pnpm --filter @wbcnc/i18n test -- run` covers language preference resolution, catalog coverage, placeholders, fallback, interpolation and plurals. The app's `LanguageSelector.test.tsx` covers persistence failures and the reload guard. `BoundsInfo.test.tsx` checks that relative time follows the application language. Test screens and machine controls with the demo controller; localization does not require real machine movement.

The English source remains readable for upstream review. Translations are deliberately kept out of G-code generation, expressions and persisted design identifiers. The application locale changes display language, not numeric input syntax: fields that require decimal dots continue to require them.

The browser value-parser adapter in `src/cad/valueExpressions.ts` localizes known input diagnostics at presentation time. `@wbcnc/cad` still returns its original English diagnostics for Node and structured consumers. Keep successful numeric values and serialized expressions identical, and preserve unknown diagnostics instead of hiding them. `valueExpressions.localization.test.ts`, `PartPropertiesDialog.localization.test.tsx` and the degree-of-freedom test cover these presentation boundaries. The extraction guard has its own check: `node --test scripts/i18n-interpolations.test.mjs`.
