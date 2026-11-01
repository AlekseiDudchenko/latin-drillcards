CREATE TABLE progress (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise   text        NOT NULL,
  level      text        NOT NULL,
  item_id    text        NOT NULL,
  tag        text,
  correct    int         NOT NULL DEFAULT 0,
  wrong      int         NOT NULL DEFAULT 0,
  last_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, exercise, level, item_id)
);

ALTER TABLE progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own progress"
  ON progress FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_progress_exercise_level ON progress (user_id, exercise, level);
