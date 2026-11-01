CREATE OR REPLACE FUNCTION upsert_progress(
    p_user_id  uuid,
    p_exercise text,
    p_level    text,
    p_item_id  text,
    p_tag      text,
    p_correct  int,
    p_wrong    int
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    INSERT INTO progress (user_id, exercise, level, item_id, tag, correct, wrong, last_at)
    VALUES (p_user_id, p_exercise, p_level, p_item_id, p_tag, p_correct, p_wrong, now())
    ON CONFLICT (user_id, exercise, level, item_id)
    DO UPDATE SET
        correct = progress.correct + EXCLUDED.correct,
        wrong   = progress.wrong   + EXCLUDED.wrong,
        tag     = COALESCE(EXCLUDED.tag, progress.tag),
        last_at = now();
$$;
