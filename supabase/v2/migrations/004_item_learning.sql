-- G3 / #332. Forward migration after 003: the same journal, task archive and commit
-- RPC for every target. Item datasets (sentences, grammar, phrases, audio/video
-- segments, tests) are immutable and versioned; a task pins one dataset version and
-- the Edge Function re-evaluates answers against it. Only words have a server
-- projection: item statistics, daily activity and test results are rebuilt from the
-- journal by the shared core, so an item can never raise WordProgress.
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtextextended('drillcards-v2-install',0));
DO $$ BEGIN
  IF to_regclass('public.learning_events') IS NULL THEN
    RAISE EXCEPTION 'Apply 003_learning first' USING ERRCODE='55000';
  END IF;
  IF to_regclass('catalog_private.item_datasets') IS NOT NULL THEN
    RAISE EXCEPTION 'Item learning migration already applied; nothing changed' USING ERRCODE='55000';
  END IF;
END $$;

CREATE TABLE catalog_private.item_datasets (
  dataset_id text NOT NULL CHECK (btrim(dataset_id) <> '' AND dataset_id = btrim(dataset_id) AND position(':' IN dataset_id) = 0),
  version text NOT NULL CHECK (btrim(version) <> '' AND version = btrim(version)),
  kind text NOT NULL CHECK (kind IN ('sentence','grammar-item','phrase','video-segment','assessment')),
  dataset jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, version),
  -- The stored model names itself; the shared core validates the rest before publishing.
  CHECK (dataset->>'id' = dataset_id AND dataset->>'version' = version AND dataset->>'kind' = kind
    AND jsonb_typeof(dataset->'items') = 'array' AND jsonb_array_length(dataset->'items') > 0)
);
ALTER TABLE catalog_private.item_datasets ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON catalog_private.item_datasets
  FOR EACH ROW EXECUTE FUNCTION catalog_private.reject_mutation();
REVOKE ALL ON catalog_private.item_datasets FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON catalog_private.item_datasets TO service_role;
-- Published datasets are public content, like catalog_words.
CREATE VIEW public.catalog_item_datasets WITH (security_barrier=true) AS
SELECT dataset_id, version, kind, dataset, published_at FROM catalog_private.item_datasets;
REVOKE ALL ON public.catalog_item_datasets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.catalog_item_datasets TO anon, authenticated, service_role;

-- Item tasks: target kind and dataset/item identity instead of a word snapshot.
ALTER TABLE public.learning_tasks
  ADD COLUMN target_kind text NOT NULL DEFAULT 'word'
    CHECK (target_kind IN ('word','sentence','grammar-item','phrase','video-segment','assessment')),
  ADD COLUMN dataset_id text,
  ADD COLUMN item_id text,
  ADD COLUMN dataset_version text,
  ALTER COLUMN catalog_version DROP NOT NULL,
  ALTER COLUMN word_id DROP NOT NULL,
  ADD CONSTRAINT learning_task_target CHECK (CASE WHEN target_kind = 'word'
    THEN catalog_version IS NOT NULL AND word_id IS NOT NULL AND dataset_id IS NULL AND item_id IS NULL AND dataset_version IS NULL
    ELSE catalog_version IS NULL AND word_id IS NULL AND dataset_id IS NOT NULL AND item_id IS NOT NULL AND dataset_version IS NOT NULL END),
  ADD CONSTRAINT learning_task_dataset FOREIGN KEY (dataset_id, dataset_version)
    REFERENCES catalog_private.item_datasets(dataset_id, version);
ALTER TABLE public.learning_tasks ALTER COLUMN target_kind DROP DEFAULT;
CREATE INDEX learning_events_item ON public.learning_events(user_id, dataset_id, item_id) WHERE dataset_id IS NOT NULL;

-- Service read: one pinned dataset version, or NULL.
CREATE FUNCTION public.v2_item_dataset(p_dataset_id text, p_version text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT d.dataset FROM catalog_private.item_datasets d WHERE d.dataset_id = p_dataset_id AND d.version = p_version
$$;

-- The same narrow write path as 003, now for every target kind.
CREATE OR REPLACE FUNCTION public.v2_commit_learning(p_user_id uuid, p_data_epoch text, p_received_at timestamptz,
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
  v_word boolean;
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
    v_word := v_ev->'target'->>'kind' = 'word';
    IF v_ev->>'dataEpoch' IS DISTINCT FROM p_data_epoch
      OR v_ev->'target'->>'kind' NOT IN ('word','sentence','grammar-item','phrase','video-segment','assessment')
      OR v_task->>'id' IS DISTINCT FROM v_ev->>'taskId' OR v_task->'target' IS DISTINCT FROM v_ev->'target'
      OR v_task->>'exerciseId' IS DISTINCT FROM v_ev->>'exerciseId' OR v_task->>'taskVersion' IS DISTINCT FROM v_ev->>'taskVersion'
      OR v_task->'contentVersion' IS DISTINCT FROM v_ev->'contentVersion'
      OR (v_ev->>'kind' = 'answer') IS DISTINCT FROM coalesce(jsonb_typeof(v_item->'evaluation') = 'object', false) THEN
      RAISE EXCEPTION 'Event/task binding mismatch' USING ERRCODE = '22023';
    END IF;
    -- Only words have a projection; item events are journal facts (their statistics are rebuilt from it).
    IF v_word AND NOT v_ev->'target'->>'wordId' = ANY(v_event_words) THEN v_event_words := v_event_words || (v_ev->'target'->>'wordId'); END IF;

    INSERT INTO public.learning_tasks(user_id, task_id, session_id, target_kind, catalog_version, word_id, dataset_id, item_id,
      dataset_version, content_version, exercise_id, task_version, task)
    VALUES (p_user_id, v_task->>'id', v_ev->>'sessionId', v_ev->'target'->>'kind',
      CASE WHEN v_word THEN v_task->'specification'->>'catalogVersion' END, v_ev->'target'->>'wordId',
      v_ev->'target'->>'datasetId', v_ev->'target'->>'itemId', CASE WHEN NOT v_word THEN v_task->'specification'->>'datasetVersion' END,
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
    INSERT INTO public.learning_events(user_id, event_id, sequence, data_epoch, kind, target_kind, word_id, dataset_id, item_id,
      exercise_id, session_id, task_id, command_id, attempt_id, content_version, occurred_at, received_at, event, evaluation)
    VALUES (p_user_id, v_ev->>'eventId', v_cursor_value, v_ev->>'dataEpoch', v_ev->>'kind', v_ev->'target'->>'kind',
      v_ev->'target'->>'wordId', v_ev->'target'->>'datasetId', v_ev->'target'->>'itemId',
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

REVOKE ALL ON FUNCTION public.v2_item_dataset(text, text),
  public.v2_commit_learning(uuid, text, timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2_item_dataset(text, text),
  public.v2_commit_learning(uuid, text, timestamptz, jsonb, jsonb) TO service_role;
