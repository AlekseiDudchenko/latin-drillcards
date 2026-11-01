-- SRS decks are per exercise type: the same word id exists as a recognition
-- card ('word') and a production card ('word_prod'), scheduled independently.
-- The original PK (user_id, card_id) made a production upsert overwrite the
-- recognition row — include card_type in the card identity.

ALTER TABLE srs_cards DROP CONSTRAINT srs_cards_pkey;
ALTER TABLE srs_cards ADD PRIMARY KEY (user_id, card_type, card_id);

-- Same signature as 005, only the conflict target changes.
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
$$;

REVOKE EXECUTE ON FUNCTION sync_srs_card FROM anon;
