CREATE TABLE srs_cards (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id     text        NOT NULL,
  card_type   text        NOT NULL DEFAULT 'word',
  state       smallint    NOT NULL DEFAULT 0,
  stability   real        NOT NULL DEFAULT 0,
  difficulty  real        NOT NULL DEFAULT 5.0,
  due         timestamptz NOT NULL DEFAULT now(),
  last_review timestamptz,
  reps        smallint    NOT NULL DEFAULT 0,
  lapses      smallint    NOT NULL DEFAULT 0,

  PRIMARY KEY (user_id, card_id)
);

-- Partial index: only active cards need fast due-date lookup
CREATE INDEX idx_srs_due ON srs_cards (user_id, due) WHERE state > 0;

ALTER TABLE srs_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own srs_cards"
  ON srs_cards FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Upsert with last_review as conflict resolver (newer review wins).
-- user_id comes from auth.uid(), never from the client: a SECURITY DEFINER
-- function bypasses RLS, so a client-supplied user_id would let any caller
-- write other users' rows.
DROP FUNCTION IF EXISTS sync_srs_card(uuid, text, text, smallint, real, real, timestamptz, timestamptz, smallint, smallint);

CREATE OR REPLACE FUNCTION sync_srs_card(
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
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO srs_cards
    (user_id, card_id, card_type, state, stability, difficulty, due, last_review, reps, lapses)
  VALUES
    (auth.uid(), p_card_id, p_card_type, p_state, p_stability, p_difficulty, p_due, p_last_review, p_reps, p_lapses)
  ON CONFLICT (user_id, card_id)
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
$$;

REVOKE EXECUTE ON FUNCTION sync_srs_card FROM anon;
