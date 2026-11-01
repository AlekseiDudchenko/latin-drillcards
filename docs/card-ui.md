# Reusable card UI (X1 / #312)

`src/client/v2` contains framework-free DOM components: CardShell, ChoiceInput,
TextInput, RevealInput and WordDetails. X2 adds a passive introduction input; G1 (#330) adds
TokenInput for assembling an answer from tokens. They receive immutable published content
and callbacks, and never evaluate answers, write progress, access Supabase or
read the current account. The core remains DOM-free. Type-only imports refer to
the core declarations emitted by `npm run build:core`; no core or server module
is loaded into the browser through those type imports.

## Task definition, presentation and draft

`createCardShell(host, definition, presentation, actions, initialState?, adapters?)`
returns getState, setPresentation, restoreState and dispose. The host is owned
exclusively by that instance until disposal. Dispose the previous instance before
mounting another task. Use a separate speech adapter per instance.

The task definition fixes ID, content prompt/language, input kind, choice IDs and
order, reveal answer, published word details, answer translation language and
optional German speech text. A UI locale change does not rebuild this definition
or swap RU/EN answer content. Custom instructional titles require EN/RU/DE text;
default titles are localized by input kind.
Choice content has its own required answerLang, applied to radio labels and controls;
changing the UI language never changes the pronunciation language of its options.

Presentation contains UI language, permissions, optional busy state and feedback.
`setPresentation` updates these without resetting the draft, selected option,
revealed answer, submitted state or details-open state. `getState` returns a
snapshot of these UI values, suitable for the future Runner to persist alongside
its task/session state. `restoreState` validates the snapshot and refuses to run
while a command is pending. These are UI snapshots, not trusted learning facts.

The built-in inputs use visible labels, native radios/text/forms/buttons, scoped
keyboard handlers and polite feedback. Native radio arrows/Space and numbers 1–9
select; selection alone never submits. Text Enter submits except during IME
composition. Empty answers cannot submit. Choice IDs rather than labels are sent
to the exercise adapter. Reveal answers never enter the DOM before permitted,
successful disclosure; catalog text is inserted via textContent, never HTML.

## TokenInput (G1 / #330)

Input `{ kind: 'tokens', answerLang, tokens, autoSubmit }` assembles an answer from
`tokens: { id, text }[]` given in display order. The pure state lives in
`token-state.ts` (no DOM, unit-tested) and is used by the DOM component
`card-tokens.ts` through CardShell; neither grades nor writes progress.

- **Identity.** A token is its ID, never its text. Content adapters build IDs from
  the source position (`<itemId>:<index>`, `answerTokens`), so a sentence repeating
  "ich" has two distinct tokens, and the IDs do not depend on the shuffle.
- **State.** `CardInputState.tokens = { pool, answer }` holds IDs only. `pool +
  answer` is always exactly a permutation of the definition's IDs: place, return,
  reorder, drag and reset never lose or duplicate a token, and `restoreState`
  refuses a snapshot that would. The pool is canonical (definition order); a
  returned token goes back to its original slot, and reset restores the original
  layout rather than reshuffling. `value` is the answer text (texts joined by a
  space), derived from the placement; a snapshot whose `value` disagrees is refused.
- **Order.** The definition fixes the display order once per task, so rerender and
  language switches never reshuffle. Adapters take an optional `order` permutation
  (`arrangeTokens`, validated); the Runner can persist it to restore after reload.
- **Interaction.** Click or tap: pool token → end of answer, answer token → back to
  the pool. Keyboard (native buttons): Enter/Space toggles, ←/→ moves focus within
  a row, Shift+←/→ moves an answer token, Backspace/Delete returns it. Focus
  follows the work: the next pool token after placing, the neighbouring answer token
  after returning, the moved token after reordering. Pointer drag (mouse and touch,
  6px threshold) inserts at the drop position in reading order (`dropIndex`), drags
  back to the pool, or snaps back when dropped elsewhere or on Escape. Reset returns
  everything. The keyboard hint is hidden on coarse pointers.
- **Submit.** `onSubmit({ taskId, kind: 'tokens', value, tokens })` sends the answer
  token IDs alongside the text. Check submits explicitly. With `autoSubmit`, the
  move that empties a non-empty pool submits once (`becameFilled`); rerenders,
  language switches, reorders of a full answer and failed submits never submit by
  themselves, and the usual single-flight lock blocks Check/Enter/rerender while
  that submit is pending. A rejected submit keeps the placement; Check retries.
  After acceptance the tokens are disabled; a retry after a wrong answer is the
  Runner's decision (`restoreState` or a new task), not the component's.
- **Cleanup.** Click/key/pointer handlers are scoped to the per-render AbortSignal;
  an active drag's window listeners are tied to it, so rerender or dispose ends the
  drag and clears its styles.

Families use it through pure content adapters in `token-tasks.ts`, with no copies of
the component:

| Adapter | Family (matrix) | Prompt | autoSubmit |
| --- | --- | --- | --- |
| `sentenceAssemblyCard(item, translationLanguage, order?)` | FC03 sentence assembly, `sentences-<level>.json` | RU/EN translation (missing → RangeError); German speech of the target | yes — every token belongs to the answer |
| `konjunktivTokenCard(item, translationLanguage, order?)` | FC08 Konjunktiv II, `konjunktiv2-<kind>.json` | the gapped German sentence | no — distractors stay in the pool |

Grading (alternatives, punctuation), statistics and the Runner wiring of these
families belong to M1 #333 and M5 #337; listening and video (M2 #334, M6 #338)
reuse the same input with their own prompt.

## Shared Check / Next action

Regular and cloze cards use `cardPrimaryAction` for the same primary action slot.
Exercise pages pass `onNext` to advance their Runner or select the next item.
Before acceptance, Check is enabled for a non-empty regular answer or a complete
cloze answer. After acceptance, Next replaces Check in place and receives focus,
for either outcome. Inputs stay locked, and pending actions block duplicate commands.
Cloze Reset disappears after acceptance. Read-only history cards omit `onNext`.

Every active exercise family uses this flow. Token assembly waits for an explicit
Check, and the level test waits for Next instead of advancing on a timer. Reveal
cards keep their Show answer / self-rating steps, then offer Next like word cards.

## Commands and disclosure

| Callback | Contract |
| --- | --- |
| onChange(state) | Synchronous observer for UI draft/state; it must not own answer acceptance. Async persistence/errors belong to the Runner. |
| onContinue(taskId) | Required for introduction; advances after acceptance without producing an answer. |
| onSubmit({ taskId, kind, value, tokens? }) | Choice/text/reveal/tokens Runner command; resolve after acceptance/commit, reject on failure. No grading occurs in CardShell. |
| onReveal(taskId, 'answer' or 'word-details') | Complete the disclosure command before the UI mounts its answer/details. |
| onSpeech(taskId) | Complete the exposure command before handing text to speech synthesis. |

Callbacks may return promises, except the synchronous onChange observer. The UI
locks a pending command immediately, so rerender/double-click/Enter cannot submit
another answer in flight. A rejected command preserves the draft for retry. A
successful submit marks the local input submitted; the exercise/Runner supplies
feedback. Observer exceptions do not turn an accepted submit into a retry.
Persistent command IDs, deduplication across reloads and actual atomic storage
belong to L2/S0, not these controls. This PR does not implement a SessionRunner.

Word cards with `autoSpeak` show an automatic-speech switch. Its checked state is
the saved preference for subsequent cards, including introductions, rather than
the current playback state. It defaults to enabled and persists in localStorage
(`dc_v2_word_auto_speak`), with an in-memory fallback when storage is unavailable.
Enabling it takes effect on the next automatic reading; disabling also cancels
current speech. Finishing a reading does not change the preference. Clicking the
German headword plays or stops the current word without changing this setting;
the word is a native button that also supports Enter/Space. When the question is
a translation, the clickable German word appears only after feedback permits
speech (or in the open word details). There is no separate Listen button on word cards.
German example sentences in the introduction and open word details use the same
click/Enter/Space behavior. Clicking another example or the headword replaces the
current reading; clicking the active text again stops it. Translations stay plain
text, and manual example playback does not change the automatic-speech preference.
The switch stays available while speech is gated, but both automatic and manual
playback still respect exposure permissions and the task's start/correct timing.

All disclosure is separately permitted: reveal, word details and German speech.
The exercise adapter/Runner must supply permissions appropriate to the current
stage and record the exposed components. The UI never infers permission merely
because the target answer exists in memory. Revoking speech permission cancels
waiting/active speech. Async callbacks recheck permission and disposal before
showing content or playing audio. Disposal aborts scoped event handlers, cancels
voice waits/playback, removes the DOM and prevents late command completion from
remounting it. In-flight durable commands are not undone by leaving the page.

Introduction displays permitted word details immediately and uses Continue. The
Runner must persist its introduction/exposure before mounting; onContinue does not
replace that fact. It never calls onSubmit or offers a self-rating. See
[word-exercises.md](word-exercises.md) for the canonical task adapter and permissions.

## ClozeInput (G2 / #331)

`cloze-model.ts` is the pure, DOM-free part; `cloze-input.ts` re-exports it and
adds the DOM `ClozeInput` plus the `createClozeCard` controller. Gap exercises
(relative pronouns, Passiv and later Kasus, M3 #335 / M4 #336) are all one
mechanism: a definition with slots, typed or chosen. The component knows no
German topic, SRS, storage or server; it receives a definition and callbacks,
never grades and never writes progress.

**Definition.** `{ id, answerLang, segments, slots, title?, prompt? }`.
`segments` interleave text with `{ kind: 'slot', slotId }`; `slots` lists each
slot once, in the same order (that order is reading and focus order), as
`{ slotId, input: 'text' }` or `{ slotId, input: 'choice', options }`. Slot IDs are
stable task identities, not DOM indexes; `parseClozeTemplate('Das ___ ist ___.')`
yields `slot-1`, `slot-2`… for `___`-style data such as v1 `gaps.json` and
`passiv-gaps.json`. Text and choice slots may be mixed. Choice slots render one
reused `ChoiceInput` each (legend "Gap n of m"); several slots may share the same
option list, and one option may fill several slots (repeated options). Text
slots reuse `TextInput` inline with a visually hidden "Gap n of m" label. The
definition is validated and copied once; a UI language change never rebuilds it.

**State.** `{ values: Record<slotId, string>, submitted }`: raw text, or the option
ID for choice slots. `getState`, `restoreState` (validated: foreign slots,
unknown option IDs, or "submitted with empty slots" are rejected) and `onChange`
use this snapshot, like CardShell. Pure helpers: `emptyClozeState`,
`setSlotValue`, `resetCloze`, `isClozeComplete`, `nextEmptySlot`,
`validateClozeState`. After submission the state is immutable: writes and reset
return it unchanged.

**Commands.** Checking is explicit: Check is enabled only when every slot is
filled, and filling the last slot never auto-submits. `onSubmit({ taskId, kind:
'cloze', values })` sends all slots in one command with the same single-flight,
retry-on-reject and dispose rules as CardShell; after acceptance every input,
Inputs are locked, so no second answer write is possible; with `onNext`, Next replaces Check and Reset is hidden. Reset ("Clear
answers") empties all slots before the check and returns focus to the first
slot. A retry after a wrong answer is a new task or a restored empty state owned
by the Runner, not a second write to the same one.

**Per-slot results.** The exercise adapter grades with the pure
`evaluateCloze(definition, key, values)`, which returns an outcome per slot plus
totals. The key holds, per slot, accepted text forms or accepted option IDs
(alternative answers), an optional `caseSensitive` rule (default: case-insensitive
after trimming, whitespace collapse and NFC) and optional `interchangeable`
groups whose accepted sets match in any order, each set used once (ties keep
authored order; at most 6 slots per group). The adapter then passes
`presentation.slotResults: Record<slotId, { outcome, expected? }>` and the usual
`feedback`. Each slot is marked, and a "Results by gap" list names each slot's
outcome; `expected` appears only if the adapter includes it, so disclosure stays
the adapter's decision.

**Keyboard and focus.** Tab follows DOM order: inline text slots and choice
markers in the sentence, then the choice groups, Check, Reset. A choice slot's
inline marker moves focus to its group. Enter in a slot checks a complete
answer, otherwise moves to the next empty slot (wrapping); Enter during IME
composition is ignored. In a choice group, arrows and Space work natively;
digits 1–9 pick an option and move to the next empty slot, or to Check when all
are filled. Rerenders (language, presentation, a choice repaint) keep values,
the focused control and the text caret.

Demo: `/v2/cloze-demo.html` (noindex fixture: a relative-pronoun gap with an
alternative answer, Passiv Perfekt by choice and by typing, and a repeated
option). Its fixture adapter, not the component, grades and discloses expected
forms.

## Existing adapters

Localization adds a typed `cardUi` section to the existing EN/RU/DE tables.
`cardUiTranslations(lang)` reads a table without changing settings or the app's
global locale. The shell never writes localStorage. Theme follows the existing
`documentElement.dataset.theme` convention through scoped CSS variables; no
theme-specific task/draft copy is created.

The shared pure German voice picker is extracted from the existing TTS module;
its existing export remains available to the old screens. The new scoped speech
adapter uses that picker but owns its async lifecycle: voice-list listeners,
timeouts, utterance callbacks and playback token. It waits briefly for voices,
requires a German voice, reports unsupported/missing/failed playback and cancels
pending work on disposal. Starting another card's playback releases the previous
one; disposing an older card cannot cancel a newer card's audio.
The same request ownership also cancels earlier voice waits, preventing a late
voiceschanged event from starting an older card over newer playback. No silent
English default voice is used. Actual device voices/network availability remain
platform-dependent.

Include `v2/card-ui.css` once in the consuming page. Styles are scoped under
`dc-*` classes, support the existing light/dark theme and narrow mobile widths.

## Review surface and verification

After `npm run build && npm start`, open `/v2/card-ui-demo.html`. It is a noindex
standalone preview using fixture content, with the choice/text/reveal inputs and the
two token families (a published A2 sentence with a repeated "ich" and a Konjunktiv II
item with distractors), UI locale
switching, theme and disclosure permissions. It is not linked from production
navigation, does not claim to be a finished learning session, and does not publish
its fixture into the catalog. The production exercises are X2/X3; shell/Runner
integration follows in L2. Paths are relative for root or GitHub Pages deployment.

Checks:

```sh
npm run verify
npx tsc -p test/tsconfig.json
npx playwright test test/card-ui.spec.ts test/token-input.spec.ts test/cloze-input.spec.ts --workers=1
```

Playwright uses its installed Chromium by default. A local browser can be supplied
through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. The focused suite runs the actual
compiled UI in Chromium and covers locale/state, keyboard/IME, delayed disclosure,
single-flight/retry, permission revocation, HTML-safe word details, unmount races,
360/768/1280 widths, theme and scoped speech lifecycle. `token-input.spec.ts` covers
click, keyboard, drag, duplicates, reset, rerender/language switch and snapshots, a
single autocheck submit (also after failure), dispose during a drag and a 360px touch
layout; `token-state.test.mjs` covers the pure state and both content adapters
against every published sentence and Konjunktiv II record. Browser assertions stub
speech synthesis where needed; they cannot verify a physical speaker or a real
device's installed voice quality. The standalone preview imports no Supabase SDK
and needs no external service to run these tests.
`test/cloze-model.test.mjs` unit-tests the pure slot logic (and maps every v1
`gaps.json` / `passiv-gaps.json` item onto it); `test/cloze-input.spec.ts` covers
one and several gaps, repeated options, alternatives, per-slot results, reset,
focus/keyboard, no second submit, rerender/language switch, 360px and Passiv plus
ordinary gaps on the same component.
