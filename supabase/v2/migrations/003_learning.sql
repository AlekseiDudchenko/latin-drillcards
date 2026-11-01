-- S1 / #319. Forward migration after 001/002: server journal of learning events,
-- trusted task archive, word projection and the service-only commit RPC.
-- Browsers only read their own rows. Every write goes through v2_commit_learning,
-- which the v2-learning-events Edge Function calls with the owner taken from Auth.

-- Historical catalog snapshot: which word revisions a catalog version contained.
-- A growing current catalog never replaces it when a pinned task is re-evaluated.
CREATE TABLE catalog_private.catalog_snapshot_words (
  catalog_version text NOT NULL REFERENCES catalog_private.catalog_imports(catalog_version),
  word_id text NOT NULL,
  content_version integer NOT NULL,
  PRIMARY KEY (catalog_version, word_id),
  UNIQUE (catalog_version, word_id, content_version),
  FOREIGN KEY (word_id, content_version) REFERENCES catalog_private.word_publications(word_id, content_version)
);
ALTER TABLE catalog_private.catalog_snapshot_words ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON catalog_private.catalog_snapshot_words
  FOR EACH ROW EXECUTE FUNCTION catalog_private.reject_mutation();
REVOKE ALL ON catalog_private.catalog_snapshot_words FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON catalog_private.catalog_snapshot_words TO service_role;

-- Runs at commit of the import transaction, after published_version is moved,
-- whatever order the importer inserts its rows in.
CREATE FUNCTION catalog_private.snapshot_import() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO catalog_private.catalog_snapshot_words(catalog_version, word_id, content_version)
  SELECT NEW.catalog_version, w.id, w.published_version
  FROM catalog_private.words w WHERE w.published_version IS NOT NULL;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION catalog_private.snapshot_import() FROM PUBLIC, anon, authenticated, service_role;
CREATE CONSTRAINT TRIGGER snapshot_import AFTER INSERT ON catalog_private.catalog_imports
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION catalog_private.snapshot_import();
-- An install that predates this migration: only its latest import is still the
-- current published set. Older imports (if any) have no reconstructable snapshot.
INSERT INTO catalog_private.catalog_snapshot_words(catalog_version, word_id, content_version)
SELECT i.catalog_version, w.id, w.published_version
FROM (SELECT catalog_version FROM catalog_private.catalog_imports
      ORDER BY imported_at DESC, catalog_version DESC LIMIT 1) i
CROSS JOIN catalog_private.words w WHERE w.published_version IS NOT NULL;

-- Per-owner journal cursor. Commits of one owner are serialized on this row, so
-- event sequences grow in commit order and `sequence > cursor` never skips a row.
CREATE TABLE public.learning_owners (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  journal_revision bigint NOT NULL DEFAULT 0 CHECK (journal_revision >= 0)
);
-- Immutable canonical task, rebuilt by the server from the pinned catalog snapshot.
CREATE TABLE public.learning_tasks (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id text NOT NULL CHECK (btrim(task_id) <> '' AND length(task_id) <= 200),
  session_id text NOT NULL CHECK (btrim(session_id) <> '' AND length(session_id) <= 200),
  catalog_version text NOT NULL,
  word_id text NOT NULL,
  content_version integer NOT NULL,
  exercise_id text NOT NULL,
  task_version text NOT NULL,
  task jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, task_id),
  FOREIGN KEY (catalog_version, word_id, content_version)
    REFERENCES catalog_private.catalog_snapshot_words(catalog_version, word_id, content_version)
);
-- Shared journal: target kind plus word or dataset/item (#332 adds other targets).
CREATE TABLE public.learning_events (
  user_id uuid NOT NULL,
  event_id text NOT NULL CHECK (btrim(event_id) <> '' AND length(event_id) <= 200),
  sequence bigint NOT NULL CHECK (sequence > 0),
  data_epoch text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('answer','introduction','reveal')),
  target_kind text NOT NULL CHECK (target_kind IN ('word','sentence','grammar-item','phrase','video-segment','assessment')),
  word_id text,
  dataset_id text,
  item_id text,
  exercise_id text NOT NULL,
  session_id text NOT NULL,
  task_id text NOT NULL,
  command_id text NOT NULL CHECK (btrim(command_id) <> '' AND length(command_id) <= 200),
  attempt_id text CHECK (attempt_id IS NULL OR (btrim(attempt_id) <> '' AND length(attempt_id) <= 200)),
  content_version integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  event jsonb NOT NULL,
  -- Server-computed by the shared core; never the client's claim.
  evaluation jsonb,
  PRIMARY KEY (user_id, event_id),
  UNIQUE (user_id, sequence),
  UNIQUE (user_id, command_id),
  UNIQUE (user_id, attempt_id),
  CHECK ((kind = 'answer') = (attempt_id IS NOT NULL AND evaluation IS NOT NULL)),
  CHECK (CASE WHEN target_kind = 'word' THEN word_id IS NOT NULL AND dataset_id IS NULL AND item_id IS NULL
    ELSE word_id IS NULL AND dataset_id IS NOT NULL AND item_id IS NOT NULL END),
  FOREIGN KEY (user_id) REFERENCES public.learning_owners(user_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, task_id) REFERENCES public.learning_tasks(user_id, task_id) ON DELETE CASCADE
);
CREATE INDEX learning_events_word ON public.learning_events(user_id, word_id) WHERE word_id IS NOT NULL;
-- Rebuildable projection. `revision` is the server CAS generation, not the
-- projector's transition count; `journal_revision` is the owner cursor it saw.
CREATE TABLE public.word_progress (
  user_id uuid NOT NULL REFERENCES public.learning_owners(user_id) ON DELETE CASCADE,
  word_id text NOT NULL REFERENCES catalog_private.words(id),
  data_epoch text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  journal_revision bigint NOT NULL CHECK (journal_revision > 0),
  progress jsonb NOT NULL,
  replay jsonb NOT NULL,
  introduced_at timestamptz,
  next_due_at timestamptz,
  as_of timestamptz NOT NULL,
  PRIMARY KEY (user_id, word_id)
);
CREATE INDEX word_progress_due ON public.word_progress(user_id, next_due_at);

CREATE FUNCTION public.reject_learning_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Learning journal is append-only' USING ERRCODE = '55000'; END;
$$;
CREATE TRIGGER immutable_journal BEFORE UPDATE ON public.learning_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_learning_mutation();
CREATE TRIGGER immutable_task BEFORE UPDATE ON public.learning_tasks
  FOR EACH ROW EXECUTE FUNCTION public.reject_learning_mutation();

-- Browsers read only their own rows and never write. The service has no direct
-- table writes either: only the commit RPC below can change learning state.
ALTER TABLE public.learning_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.word_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_cursor ON public.learning_owners FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY own_tasks ON public.learning_tasks FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY own_events ON public.learning_events FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY own_progress ON public.word_progress FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.learning_owners, public.learning_tasks, public.learning_events, public.word_progress
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.learning_owners, public.learning_tasks, public.learning_events, public.word_progress
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_learning_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.v2_iso(value timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- Service read: one immutable catalog snapshot as published Word models, or NULL.
CREATE FUNCTION public.v2_catalog_snapshot(p_catalog_version text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN i.catalog_version IS NULL THEN NULL ELSE jsonb_build_object('catalogVersion', i.catalog_version,
    'words', coalesce((SELECT jsonb_agg(v.word ORDER BY s.word_id)
      FROM catalog_private.catalog_snapshot_words s
      JOIN catalog_private.published_word_versions v ON v.word_id = s.word_id AND v.content_version = s.content_version
      WHERE s.catalog_version = i.catalog_version), '[]'::jsonb)) END
  FROM (SELECT p_catalog_version AS requested) r
  LEFT JOIN catalog_private.catalog_imports i ON i.catalog_version = r.requested
$$;

-- Service read for one ingestion attempt: environment, cursor, word journals and
-- CAS revisions, archived tasks and any stored event sharing a new identity.
CREATE FUNCTION public.v2_learning_state(p_user_id uuid, p_word_ids text[], p_task_ids text[],
  p_event_ids text[], p_command_ids text[], p_attempt_ids text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH fact AS (
    SELECT e.*, jsonb_build_object('event', e.event, 'receivedAt', public.v2_iso(e.received_at))
      || CASE WHEN e.evaluation IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('evaluation', e.evaluation) END AS body
    FROM public.learning_events e WHERE e.user_id = p_user_id
  )
  SELECT jsonb_build_object(
    'dataEpoch', env.data_epoch, 'epochStartedAt', public.v2_iso(env.epoch_started_at),
    'journalRevision', coalesce((SELECT o.journal_revision FROM public.learning_owners o WHERE o.user_id = p_user_id), 0),
    'words', coalesce((SELECT jsonb_agg(jsonb_build_object('wordId', w.id,
        'revision', coalesce((SELECT p.revision FROM public.word_progress p WHERE p.user_id = p_user_id AND p.word_id = w.id), 0),
        'facts', coalesce((SELECT jsonb_agg(f.body ORDER BY f.sequence) FROM fact f WHERE f.word_id = w.id), '[]'::jsonb),
        'word', (SELECT v.word FROM catalog_private.published_word_versions v WHERE v.word_id = w.id
          AND v.content_version = (SELECT max(f.content_version) FROM fact f WHERE f.word_id = w.id)))
      ORDER BY w.id) FROM (SELECT DISTINCT unnest(p_word_ids) AS id) w), '[]'::jsonb),
    'tasks', coalesce((SELECT jsonb_agg(jsonb_build_object('taskId', t.task_id, 'sessionId', t.session_id, 'task', t.task) ORDER BY t.task_id)
      FROM public.learning_tasks t WHERE t.user_id = p_user_id AND t.task_id = ANY(p_task_ids)), '[]'::jsonb),
    'matches', coalesce((SELECT jsonb_agg(f.body ORDER BY f.sequence) FROM fact f
      WHERE f.event_id = ANY(p_event_ids) OR f.command_id = ANY(p_command_ids) OR f.attempt_id = ANY(p_attempt_ids)), '[]'::jsonb))
  FROM public.v2_environment env
$$;

-- The narrow write path. It accepts an already evaluated batch from the service:
-- owner from the verified session, events with their canonical tasks, and one
-- replayed projection per affected word guarded by its expected revision.
-- A stale revision raises 40001 so the service re-reads and replays again.
CREATE FUNCTION public.v2_commit_learning(p_user_id uuid, p_data_epoch text, p_received_at timestamptz,
  p_events jsonb, p_projections jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_env public.v2_environment;
  v_cursor_value bigint;
  v_item jsonb; v_ev jsonb; v_task jsonb; v_proj jsonb; v_progress jsonb;
  v_stored public.learning_tasks;
  v_existing jsonb;
  v_current_revision bigint;
  v_event_words text[] := '{}';
  v_projection_words text[] := '{}';
  v_revisions jsonb := '[]'::jsonb;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'Unknown owner' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_env FROM public.v2_environment;
  IF v_env.data_epoch IS NULL OR p_data_epoch IS DISTINCT FROM v_env.data_epoch THEN
    RAISE EXCEPTION 'Stale data epoch' USING ERRCODE = '55000';
  END IF;
  -- Receipt time is the service clock of this attempt, never a client claim.
  IF p_received_at IS NULL OR p_received_at > now() + interval '1 minute' OR p_received_at < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'Receipt time outside the service window' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_events) IS DISTINCT FROM 'array' OR jsonb_array_length(p_events) NOT BETWEEN 1 AND 100
    OR jsonb_typeof(p_projections) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid commit batch' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.learning_owners(user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT o.journal_revision INTO v_cursor_value FROM public.learning_owners o WHERE o.user_id = p_user_id FOR UPDATE;

  FOR v_proj IN SELECT value FROM jsonb_array_elements(p_projections) LOOP
    IF v_proj->>'wordId' IS NULL OR v_proj->>'wordId' = ANY(v_projection_words) THEN
      RAISE EXCEPTION 'Invalid projection batch' USING ERRCODE = '22023';
    END IF;
    v_projection_words := v_projection_words || (v_proj->>'wordId');
    SELECT p.revision INTO v_current_revision FROM public.word_progress p
      WHERE p.user_id = p_user_id AND p.word_id = v_proj->>'wordId' FOR UPDATE;
    IF coalesce(v_current_revision, 0) IS DISTINCT FROM (v_proj->>'expectedRevision')::bigint THEN
      RAISE EXCEPTION 'Projection revision conflict' USING ERRCODE = '40001';
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    v_ev := v_item->'event'; v_task := v_item->'task';
    IF v_ev->>'dataEpoch' IS DISTINCT FROM p_data_epoch OR v_ev->'target'->>'kind' IS DISTINCT FROM 'word'
      OR v_task->>'id' IS DISTINCT FROM v_ev->>'taskId' OR v_task->'target' IS DISTINCT FROM v_ev->'target'
      OR v_task->>'exerciseId' IS DISTINCT FROM v_ev->>'exerciseId' OR v_task->>'taskVersion' IS DISTINCT FROM v_ev->>'taskVersion'
      OR v_task->'contentVersion' IS DISTINCT FROM v_ev->'contentVersion'
      OR (v_ev->>'kind' = 'answer') IS DISTINCT FROM coalesce(jsonb_typeof(v_item->'evaluation') = 'object', false) THEN
      RAISE EXCEPTION 'Event/task binding mismatch' USING ERRCODE = '22023';
    END IF;
    IF NOT v_ev->'target'->>'wordId' = ANY(v_event_words) THEN v_event_words := v_event_words || (v_ev->'target'->>'wordId'); END IF;

    INSERT INTO public.learning_tasks(user_id, task_id, session_id, catalog_version, word_id, content_version,
      exercise_id, task_version, task)
    VALUES (p_user_id, v_task->>'id', v_ev->>'sessionId', v_task->'specification'->>'catalogVersion', v_ev->'target'->>'wordId',
      (v_ev->>'contentVersion')::integer, v_ev->>'exerciseId', v_ev->>'taskVersion', v_task)
    ON CONFLICT (user_id, task_id) DO NOTHING;
    SELECT * INTO v_stored FROM public.learning_tasks t WHERE t.user_id = p_user_id AND t.task_id = v_task->>'id';
    IF v_stored.task IS DISTINCT FROM v_task OR v_stored.session_id IS DISTINCT FROM v_ev->>'sessionId' THEN
      RAISE EXCEPTION 'Task identity conflict' USING ERRCODE = '23505';
    END IF;

    SELECT e.event INTO v_existing FROM public.learning_events e WHERE e.user_id = p_user_id AND e.event_id = v_ev->>'eventId';
    IF v_existing IS NOT NULL THEN
      IF v_existing IS DISTINCT FROM v_ev THEN RAISE EXCEPTION 'Conflicting event identity' USING ERRCODE = '23505'; END IF;
      CONTINUE; -- duplicate delivery: first receipt and sequence stay
    END IF;
    v_cursor_value := v_cursor_value + 1;
    INSERT INTO public.learning_events(user_id, event_id, sequence, data_epoch, kind, target_kind, word_id,
      exercise_id, session_id, task_id, command_id, attempt_id, content_version, occurred_at, received_at, event, evaluation)
    VALUES (p_user_id, v_ev->>'eventId', v_cursor_value, v_ev->>'dataEpoch', v_ev->>'kind', 'word', v_ev->'target'->>'wordId',
      v_ev->>'exerciseId', v_ev->>'sessionId', v_ev->>'taskId', v_ev->>'commandId', v_ev->>'attemptId',
      (v_ev->>'contentVersion')::integer, (v_ev->>'occurredAt')::timestamptz, p_received_at, v_ev, v_item->'evaluation');
  END LOOP;

  IF (SELECT array_agg(x ORDER BY x) FROM unnest(v_event_words) x) IS DISTINCT FROM
     (SELECT array_agg(x ORDER BY x) FROM unnest(v_projection_words) x) THEN
    RAISE EXCEPTION 'Every affected word needs exactly one projection' USING ERRCODE = '22023';
  END IF;

  FOR v_proj IN SELECT value FROM jsonb_array_elements(p_projections) LOOP
    v_progress := v_proj->'progress';
    IF v_progress->>'wordId' IS DISTINCT FROM v_proj->>'wordId'
      OR v_progress->'owner' IS DISTINCT FROM jsonb_build_object('kind', 'account', 'id', p_user_id::text)
      OR jsonb_typeof(v_progress->'components') IS DISTINCT FROM 'object' OR jsonb_typeof(v_proj->'replay') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Projection owner/word mismatch' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.word_progress AS p(user_id, word_id, data_epoch, revision, journal_revision, progress, replay,
      introduced_at, next_due_at, as_of)
    VALUES (p_user_id, v_proj->>'wordId', p_data_epoch, (v_proj->>'expectedRevision')::bigint + 1, v_cursor_value, v_progress,
      v_proj->'replay', (v_progress->>'introducedAt')::timestamptz,
      (SELECT min((c.value->>'dueAt')::timestamptz) FROM jsonb_each(v_progress->'components') c
        WHERE c.value->>'stage' <> 'unintroduced'), p_received_at)
    ON CONFLICT (user_id, word_id) DO UPDATE SET data_epoch = EXCLUDED.data_epoch, revision = EXCLUDED.revision,
      journal_revision = EXCLUDED.journal_revision, progress = EXCLUDED.progress, replay = EXCLUDED.replay,
      introduced_at = EXCLUDED.introduced_at, next_due_at = EXCLUDED.next_due_at, as_of = EXCLUDED.as_of;
    v_revisions := v_revisions || jsonb_build_object('wordId', v_proj->>'wordId', 'revision', (v_proj->>'expectedRevision')::bigint + 1);
  END LOOP;

  UPDATE public.learning_owners SET journal_revision = v_cursor_value WHERE user_id = p_user_id;
  RETURN jsonb_build_object('journalRevision', v_cursor_value, 'words', v_revisions);
END; $$;

-- Supabase grants EXECUTE on new public functions by default: narrow it explicitly.
REVOKE ALL ON FUNCTION public.v2_iso(timestamptz), public.v2_catalog_snapshot(text),
  public.v2_learning_state(uuid, text[], text[], text[], text[], text[]),
  public.v2_commit_learning(uuid, text, timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2_iso(timestamptz), public.v2_catalog_snapshot(text),
  public.v2_learning_state(uuid, text[], text[], text[], text[], text[]),
  public.v2_commit_learning(uuid, text, timestamptz, jsonb, jsonb) TO service_role;
