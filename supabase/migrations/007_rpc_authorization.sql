-- Keep existing RPC signatures so cached clients remain compatible.
-- Use the authenticated session as the owner, validate legacy p_user_id,
-- and run as the caller so table RLS remains a second authorization boundary.
BEGIN;

-- Invoker functions need table privileges; RLS still limits them to the
-- authenticated user's rows. Do not rely on project-specific default grants.
GRANT SELECT, INSERT, UPDATE ON TABLE
  public.progress, public.daily_stats, public.srs_cards TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_progress(
    p_user_id  uuid,
    p_exercise text,
    p_level    text,
    p_item_id  text,
    p_tag      text,
    p_correct  int,
    p_wrong    int
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL OR p_user_id IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.progress (user_id, exercise, level, item_id, tag, correct, wrong, last_at)
    VALUES (v_user_id, p_exercise, p_level, p_item_id, p_tag, p_correct, p_wrong, now())
    ON CONFLICT (user_id, exercise, level, item_id)
    DO UPDATE SET
        correct = progress.correct + EXCLUDED.correct,
        wrong   = progress.wrong   + EXCLUDED.wrong,
        tag     = COALESCE(EXCLUDED.tag, progress.tag),
        last_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_progress(
    p_user_id  uuid,
    p_exercise text,
    p_level    text,
    p_item_id  text,
    p_tag      text,
    p_correct  int,
    p_wrong    int
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL OR p_user_id IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.progress (user_id, exercise, level, item_id, tag, correct, wrong, last_at)
    VALUES (v_user_id, p_exercise, p_level, p_item_id, p_tag, p_correct, p_wrong, now())
    ON CONFLICT (user_id, exercise, level, item_id)
    DO UPDATE SET
        correct = GREATEST(progress.correct, EXCLUDED.correct),
        wrong   = GREATEST(progress.wrong,   EXCLUDED.wrong),
        tag     = COALESCE(EXCLUDED.tag, progress.tag),
        last_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_daily(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.daily_stats (user_id, date, answers)
  VALUES (v_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET answers = daily_stats.answers + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_daily(p_user_id uuid, p_count int)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.daily_stats (user_id, date, answers)
  VALUES (v_user_id, CURRENT_DATE, p_count)
  ON CONFLICT (user_id, date)
  DO UPDATE SET answers = GREATEST(daily_stats.answers, EXCLUDED.answers);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_srs_card(
  p_card_id     text,
  p_card_type   text,
  p_state       smallint,
  p_stability   real,
  p_difficulty  real,
  p_due         timestamptz,
  p_last_review timestamptz,
  p_reps        smallint,
  p_lapses      smallint
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.srs_cards
    (user_id, card_id, card_type, state, stability, difficulty, due, last_review, reps, lapses)
  VALUES
    (v_user_id, p_card_id, p_card_type, p_state, p_stability, p_difficulty, p_due, p_last_review, p_reps, p_lapses)
  ON CONFLICT (user_id, card_type, card_id)
  DO UPDATE SET
    state       = EXCLUDED.state,
    stability   = EXCLUDED.stability,
    difficulty  = EXCLUDED.difficulty,
    due         = EXCLUDED.due,
    last_review = EXCLUDED.last_review,
    reps        = EXCLUDED.reps,
    lapses      = EXCLUDED.lapses
  WHERE EXCLUDED.last_review IS NOT NULL
    AND (srs_cards.last_review IS NULL
         OR EXCLUDED.last_review > srs_cards.last_review);
END;
$$;

-- Functions have EXECUTE for PUBLIC by default. Revoking only anon does
-- not remove access inherited from PUBLIC; restrict both explicitly.

REVOKE EXECUTE ON FUNCTION public.upsert_progress(uuid, text, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_progress(uuid, text, text, text, text, integer, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.sync_progress(uuid, text, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_progress(uuid, text, text, text, text, integer, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_daily(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_daily(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.sync_daily(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_daily(uuid, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.sync_srs_card(text, text, smallint, real, real, timestamptz, timestamptz, smallint, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_srs_card(text, text, smallint, real, real, timestamptz, timestamptz, smallint, smallint) TO authenticated;

COMMIT;
