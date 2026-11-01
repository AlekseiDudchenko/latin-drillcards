CREATE TABLE IF NOT EXISTS daily_stats (
  user_id  uuid  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date     date  NOT NULL DEFAULT CURRENT_DATE,
  answers  int   NOT NULL DEFAULT 0,

  PRIMARY KEY (user_id, date)
);

ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own daily_stats"
  ON daily_stats FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Original increment-by-1 function (kept for backwards compatibility)
CREATE OR REPLACE FUNCTION increment_daily(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO daily_stats (user_id, date, answers)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET answers = daily_stats.answers + 1;
$$;

-- Reconciliation: set today's count to the given value if it is higher
CREATE OR REPLACE FUNCTION sync_daily(p_user_id uuid, p_count int)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO daily_stats (user_id, date, answers)
  VALUES (p_user_id, CURRENT_DATE, p_count)
  ON CONFLICT (user_id, date)
  DO UPDATE SET answers = GREATEST(daily_stats.answers, EXCLUDED.answers);
$$;
