-- Authoritative generation/configuration of v2 in the selected project. Set only by
-- the deployment/admin role, never by a browser or a learning sync service.
CREATE TABLE public.v2_environment (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  schema_version integer NOT NULL CHECK (schema_version=1),
  environment text NOT NULL CHECK (environment IN ('local','preview','production')),
  data_epoch text NOT NULL CHECK (data_epoch ~ '^[a-zA-Z0-9_-]{1,100}$'),
  epoch_started_at timestamptz NOT NULL
);
ALTER TABLE public.v2_environment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_environment FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.v2_environment TO anon,authenticated,service_role;
CREATE POLICY read_environment ON public.v2_environment FOR SELECT TO anon,authenticated USING (true);
