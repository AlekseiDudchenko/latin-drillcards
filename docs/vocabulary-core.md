# Shared learning contracts (F1 / #306)

`packages/vocabulary-core/src` is the single domain source for browser and server.
It has no platform dependencies, UI, storage, network, current-user lookup or
implicit clock. TypeScript compiles with ES2020 only and no ambient Node/DOM types.
Dates on events are supplied by the caller, in canonical UTC ISO milliseconds;
the learning timezone is retained separately.

## Build and verification

Run `npm ci && npm run verify` from the repository root (there is no GitHub CI;
`npm run deploy` runs the same build and tests). The existing app still builds and its unit tests run with the core tests.
The core's compile-time tests also check invalid contracts and absent browser APIs.

`npm run build:core` emits ESM plus declarations to
`packages/vocabulary-core/dist`. The server deployment must include that directory
and can import its `index.js`. The same artifacts are copied byte-for-byte into
`public/v2/core`; a browser entry imports the deployed `v2/core/index.js` relative
to its configured base. Both outputs are generated and ignored by Git. No npm
publication or runtime bundler is required. Server deployment wiring belongs to
F4/S1; this task checks ESM consumption in Node and artifact equality for browsers.

## Boundaries

- `Word` is a versioned **published** read model; `assertPublishedWord`/`assertDecks`
  check its structure. The initial catalog and canonical IDs come from the
  [vocabulary seed](vocabulary-seed.md). Missing RU/EN translations are
  explicit; exercise applicability must check the requested answer language.
  Candidate content, sources and revision verification remain catalog concerns.
- `WordProgress` belongs to an owner and word, never an exercise or deck. Article
  applies only to nouns with a known article. Implementations and rules are described
  in [component-srs.md](component-srs.md) and [word-evidence.md](word-evidence.md).
- `Task`, `ExerciseDefinition` and `Evaluation` separate content, mechanics and
  component grading. An exercise-specific version defines its JSON specification.
- `LearningEvent` supports word, sentence, grammar-item, phrase, video-segment and
  assessment targets. Answer, introduction and reveal are discriminated facts;
  only an answer has an attempt and raw answer. Evaluations are recomputed server
  side rather than accepted from a client. Exposure records word components;
  non-word exercises can send an empty list until their evidence policy is added.
  Every event retains intent and answerLanguage independently of the local plan:
  server replay must distinguish practice (no SRS), learning, review and assessment.
  answerLanguage is the RU/EN language of the meaning/translation in the task;
  a German production response still retains that language context.
- `isLearningEvent(unknown)` rejects unknown versions/fields, malformed targets,
  invalid times/timezones and non-JSON answers. It is an envelope guard, not
  authorization, an exercise-answer validator, a payload size/rate limit or a
  content-version lookup. Those checks belong at the authenticated service edge.
- `SessionRequest` requires an exercise for single mode and scope for a circuit.
  `VocabularySessionPlan` adds a 5/20 word batch to the generic plan; other exercise
  families share the plan without inheriting word limits. The planner must enforce
  distinct IDs, applicability, capacity and references. The
  [session planner](session-planner.md) implements L1's fixed 20/5-word batches,
  explicit practice, seeded tasks and pinned versions.
- `LearningStore` describes one atomic event/session/projection/outbox commit.
  Owner, epoch, explicit first local receivedAt and expected revision are mandatory.
  The [IndexedDB adapter](local-learning-store.md) implements atomic local
  persistence and scoped recovery. The [session runner](session-runner.md) drives
  commands, retries and resume on top of it. Sync remains a subsequent task;
  non-word projections extend the port in G3.

## Versions and fixtures

Content and event envelope schema versions start at 1. Content revisions are
positive integers, while task/evidence/scheduler policies have their own version
IDs. An incompatible envelope requires an explicit schema bump and decoder;
silently treating unknown fields as a supported historical event is forbidden.
Owner is not a field in a client event: the server derives it from authentication;
local ownership is supplied by the enclosing transaction and session.

Typed fixtures contain Tisch, gehen with no English translation, and two distinct
Band senses (der Band / das Band). They are test data, not verified public catalog
contributions. Tests cover these identities, event round trips, every target kind,
non-answer events and malformed/unsupported envelopes.

The package now includes the pure component scheduler and daily evidence policy.
It also provides [multi-day replay, queries and summary](word-projector.md).
The [word exercise registry](word-exercises.md) now supplies deterministic task
construction and answer evaluation for X2.
No production v2 screen, database or deployment is claimed complete. See #298 and architecture
PR #297 for the remaining work.

Catalog persistence and fresh Supabase bootstrap: [catalog-schema.md](catalog-schema.md) (F2 / #307).

V2 environment/Auth/deployment preparation: [v2-environments.md](v2-environments.md) (F4 / #308).
