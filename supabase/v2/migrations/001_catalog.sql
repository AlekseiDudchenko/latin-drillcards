-- F2 / #307. Additive catalog schema. The selected deployment preflight must run first.
-- Internal revisions never have client grants. API views expose pinned publications.
CREATE SCHEMA catalog_private;
REVOKE ALL ON SCHEMA catalog_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA catalog_private TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA catalog_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE catalog_private.words (
  id text PRIMARY KEY CHECK (btrim(id) <> '' AND id=btrim(id)),
  sense_id text NOT NULL UNIQUE CHECK (btrim(sense_id) <> '' AND sense_id=btrim(sense_id)),
  published_version integer,
  CHECK (published_version IS NULL OR published_version > 0)
);
-- Every text/association has an immutable revision and a hash. Identity is not a
-- translated string or spelling: homonyms and differing articles remain distinct.
CREATE TABLE catalog_private.content_revisions (
  id text PRIMARY KEY CHECK (btrim(id) <> '' AND id=btrim(id)),
  word_id text NOT NULL REFERENCES catalog_private.words(id),
  kind text NOT NULL CHECK (kind IN ('word','translation','example','example_translation','association')),
  entity_id text NOT NULL CHECK (btrim(entity_id) <> '' AND entity_id=btrim(entity_id)),
  revision integer NOT NULL CHECK (revision > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (word_id, kind, entity_id, revision),
  UNIQUE (word_id, id, kind),
  UNIQUE (id, content_hash)
);
CREATE FUNCTION catalog_private.valid_text_array(items text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(array_ndims(items),1)=1 AND NOT EXISTS (SELECT 1 FROM unnest(items) v WHERE v IS NULL OR v='' OR v<>btrim(v))
    AND cardinality(items)=(SELECT count(DISTINCT v) FROM unnest(items) v)
$$;
GRANT EXECUTE ON FUNCTION catalog_private.valid_text_array(text[]) TO service_role;

CREATE TABLE catalog_private.word_revisions (
  id text PRIMARY KEY,
  word_id text NOT NULL,
  kind text NOT NULL DEFAULT 'word' CHECK (kind = 'word'),
  lemma text NOT NULL CHECK (btrim(lemma) <> '' AND lemma=btrim(lemma) AND length(lemma) <= 500),
  part_of_speech text NOT NULL CHECK (part_of_speech IN ('noun','verb','adjective','adverb','other')),
  article text CHECK (article IN ('der','die','das')),
  accepted_forms text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  CHECK (article IS NULL OR part_of_speech = 'noun'),
  CHECK (catalog_private.valid_text_array(accepted_forms)),
  CHECK (catalog_private.valid_text_array(tags)),
  FOREIGN KEY (word_id,id,kind) REFERENCES catalog_private.content_revisions(word_id,id,kind),
  UNIQUE (word_id,id)
);
CREATE TABLE catalog_private.word_translations (
  id text PRIMARY KEY,
  word_id text NOT NULL,
  kind text NOT NULL DEFAULT 'translation' CHECK (kind = 'translation'),
  language text NOT NULL CHECK (language IN ('ru','en')),
  text text NOT NULL CHECK (btrim(text) <> '' AND text=btrim(text) AND length(text) <= 10000),
  FOREIGN KEY (word_id,id,kind) REFERENCES catalog_private.content_revisions(word_id,id,kind),
  UNIQUE (word_id,id)
);
CREATE TABLE catalog_private.examples (
  id text PRIMARY KEY,
  word_id text NOT NULL,
  kind text NOT NULL DEFAULT 'example' CHECK (kind = 'example'),
  text text NOT NULL CHECK (btrim(text) <> '' AND text=btrim(text) AND length(text) <= 10000),
  FOREIGN KEY (word_id,id,kind) REFERENCES catalog_private.content_revisions(word_id,id,kind),
  UNIQUE (word_id,id)
);
CREATE TABLE catalog_private.example_translations (
  id text PRIMARY KEY,
  word_id text NOT NULL,
  example_id text NOT NULL,
  kind text NOT NULL DEFAULT 'example_translation' CHECK (kind = 'example_translation'),
  language text NOT NULL CHECK (language IN ('ru','en')),
  text text NOT NULL CHECK (btrim(text) <> '' AND text=btrim(text) AND length(text) <= 10000),
  FOREIGN KEY (word_id,id,kind) REFERENCES catalog_private.content_revisions(word_id,id,kind),
  FOREIGN KEY (word_id,example_id) REFERENCES catalog_private.examples(word_id,id)
);
-- The association itself is reviewed: a grammatical example can use a different
-- sense. Pin both the word revision and the example revision, never their latest.
CREATE TABLE catalog_private.word_examples (
  id text PRIMARY KEY,
  word_id text NOT NULL,
  word_revision_id text NOT NULL,
  example_id text NOT NULL,
  kind text NOT NULL DEFAULT 'association' CHECK (kind = 'association'),
  FOREIGN KEY (word_id,id,kind) REFERENCES catalog_private.content_revisions(word_id,id,kind),
  FOREIGN KEY (word_id,word_revision_id) REFERENCES catalog_private.word_revisions(word_id,id),
  FOREIGN KEY (word_id,example_id) REFERENCES catalog_private.examples(word_id,id),
  UNIQUE (word_revision_id,example_id)
);
CREATE TABLE catalog_private.content_sources (
  revision_id text NOT NULL REFERENCES catalog_private.content_revisions(id),
  provider text NOT NULL CHECK (btrim(provider) <> ''),
  source_id text NOT NULL CHECK (btrim(source_id) <> ''),
  source_revision text NOT NULL CHECK (btrim(source_revision) <> ''),
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  attribution text NOT NULL CHECK (btrim(attribution) <> ''),
  license text NOT NULL CHECK (btrim(license) <> ''),
  fetched_at timestamptz NOT NULL,
  modified boolean NOT NULL DEFAULT false,
  PRIMARY KEY (revision_id, provider, source_id)
);
CREATE TABLE catalog_private.content_reviews (
  id text PRIMARY KEY,
  revision_id text NOT NULL,
  content_hash text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('confirmed','rejected','superseded')),
  reviewer_id uuid, -- historical identity; deleting Auth must not mutate a review
  reviewer_kind text NOT NULL CHECK (reviewer_kind IN ('participant','seed')),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reviewer_kind <> 'participant' OR reviewer_id IS NOT NULL),
  FOREIGN KEY (revision_id,content_hash) REFERENCES catalog_private.content_revisions(id,content_hash),
  UNIQUE (id,revision_id,decision)
);
CREATE TABLE catalog_private.word_publications (
  word_id text NOT NULL,
  content_version integer NOT NULL CHECK (content_version > 0),
  word_revision_id text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (word_id,content_version),
  FOREIGN KEY (word_id,word_revision_id) REFERENCES catalog_private.word_revisions(word_id,id),
  UNIQUE (word_id,content_version,word_revision_id)
);
ALTER TABLE catalog_private.words ADD CONSTRAINT published_word_version
  FOREIGN KEY (id,published_version) REFERENCES catalog_private.word_publications(word_id,content_version)
  DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE catalog_private.publication_items (
  word_id text NOT NULL,
  content_version integer NOT NULL,
  revision_id text NOT NULL,
  kind text NOT NULL,
  review_id text NOT NULL,
  decision text NOT NULL DEFAULT 'confirmed' CHECK (decision = 'confirmed'),
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (word_id,content_version,revision_id),
  UNIQUE (word_id,content_version,kind,position),
  FOREIGN KEY (word_id,content_version) REFERENCES catalog_private.word_publications(word_id,content_version)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (word_id,revision_id,kind) REFERENCES catalog_private.content_revisions(word_id,id,kind),
  FOREIGN KEY (review_id,revision_id,decision) REFERENCES catalog_private.content_reviews(id,revision_id,decision)
);

-- One row per catalog import: which seed/catalog version the published words came from.
CREATE TABLE catalog_private.catalog_imports (
  catalog_version text PRIMARY KEY CHECK (btrim(catalog_version) <> '' AND catalog_version=btrim(catalog_version)),
  seed_version text NOT NULL CHECK (btrim(seed_version) <> ''),
  source_ref text NOT NULL CHECK (source_ref ~ '^[0-9a-f]{40}$'),
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- Revisions, reviews, sources and publication manifests are append-only. An edit
-- creates a new revision; it cannot silently change a shown task or a past review.
CREATE FUNCTION catalog_private.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Catalog history is append-only' USING ERRCODE = '55000'; END;
$$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['content_revisions','word_revisions','word_translations','examples',
    'example_translations','word_examples','content_sources','content_reviews','word_publications','publication_items',
    'catalog_imports']
  LOOP
    EXECUTE format('ALTER TABLE catalog_private.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON catalog_private.%I FOR EACH ROW EXECUTE FUNCTION catalog_private.reject_mutation()',t);
  END LOOP;
END $$;
ALTER TABLE catalog_private.words ENABLE ROW LEVEL SECURITY;
-- service_role bypasses RLS in Supabase; no browser policies on the private tables.
REVOKE ALL ON ALL TABLES IN SCHEMA catalog_private FROM PUBLIC,anon,authenticated;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA catalog_private TO service_role;
GRANT UPDATE (published_version) ON catalog_private.words TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA catalog_private FROM PUBLIC, anon, authenticated;

-- Historical read model. Public projection is deliberately assembled from an
-- explicit manifest, not from every candidate or every confirmed revision.
CREATE VIEW catalog_private.published_word_versions AS
SELECT p.word_id, p.content_version,
  jsonb_build_object('schemaVersion',1,'id',w.id,'senseId',w.sense_id,
    'lemma',r.lemma,'partOfSpeech',r.part_of_speech,
    'contentVersion',p.content_version,'acceptedForms',to_jsonb(r.accepted_forms),
    'tags',to_jsonb(r.tags),'meanings',m.meanings,'examples',ex.examples)
    || CASE WHEN r.article IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('article',r.article) END AS word
FROM catalog_private.word_publications p
JOIN catalog_private.words w ON w.id=p.word_id
JOIN catalog_private.word_revisions r ON r.id=p.word_revision_id AND r.word_id=p.word_id
JOIN catalog_private.publication_items root ON root.word_id=p.word_id AND root.content_version=p.content_version
  AND root.revision_id=r.id AND root.kind='word'
CROSS JOIN LATERAL (
  SELECT jsonb_object_agg(language,jsonb_build_object('preferred',texts[1],
    'accepted',to_jsonb(texts[2:cardinality(texts)]))) AS meanings
  FROM (
    SELECT t.language,array_agg(t.text ORDER BY i.position) AS texts
    FROM catalog_private.publication_items i
    JOIN catalog_private.word_translations t ON t.id=i.revision_id
    WHERE i.word_id=p.word_id AND i.content_version=p.content_version AND i.kind='translation'
    GROUP BY t.language
  ) langs
) m
CROSS JOIN LATERAL (
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',er.entity_id,'text',e.text,'translations',et.translations)
    ORDER BY ei.position),'[]'::jsonb) AS examples
  FROM catalog_private.publication_items ei
  JOIN catalog_private.examples e ON e.id=ei.revision_id
  JOIN catalog_private.content_revisions er ON er.id=e.id
  JOIN catalog_private.word_examples a ON a.example_id=e.id AND a.word_revision_id=r.id
  JOIN catalog_private.publication_items ai ON ai.word_id=p.word_id AND ai.content_version=p.content_version
    AND ai.revision_id=a.id AND ai.kind='association'
  CROSS JOIN LATERAL (
    SELECT jsonb_object_agg(t.language,t.text) AS translations
    FROM catalog_private.example_translations t
    JOIN catalog_private.publication_items ti ON ti.word_id=p.word_id AND ti.content_version=p.content_version
      AND ti.revision_id=t.id AND ti.kind='example_translation'
    WHERE t.example_id=e.id
  ) et
  WHERE ei.word_id=p.word_id AND ei.content_version=p.content_version AND ei.kind='example'
    AND et.translations IS NOT NULL
) ex
WHERE m.meanings IS NOT NULL;

-- Views run with the migration owner's access. Only these curated columns cross
-- the private schema boundary; no raw provider response or reviewer UUID escapes.
GRANT SELECT ON catalog_private.published_word_versions TO service_role;

CREATE VIEW public.catalog_words WITH (security_barrier=true) AS
SELECT v.word_id AS id,v.content_version,v.word
FROM catalog_private.published_word_versions v
JOIN catalog_private.words w ON w.id=v.word_id AND w.published_version=v.content_version;

CREATE TABLE public.decks (
  id text PRIMARY KEY CHECK (btrim(id) <> '' AND id=btrim(id)),
  title text NOT NULL CHECK (btrim(title) <> '' AND length(title) <= 500),
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Separate namespaces: a personal deck ID starts with its owner's UUID, a shared one has no ':'.
  -- Nobody can take a shared ID or probe another user's deck names through a unique violation.
  CHECK (CASE WHEN owner_id IS NULL THEN position(':' IN id) = 0 ELSE starts_with(id, owner_id::text || ':') END)
);
CREATE TABLE public.deck_memberships (
  deck_id text NOT NULL REFERENCES public.decks(id) ON DELETE CASCADE,
  word_id text NOT NULL REFERENCES catalog_private.words(id),
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (deck_id,word_id),
  UNIQUE (deck_id,position)
);
ALTER TABLE public.decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deck_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_decks ON public.decks FOR SELECT TO anon USING (owner_id IS NULL);
CREATE POLICY visible_decks ON public.decks FOR SELECT TO authenticated
  USING (owner_id IS NULL OR owner_id=(SELECT auth.uid()));
CREATE POLICY own_deck_insert ON public.decks FOR INSERT TO authenticated
  WITH CHECK (owner_id=(SELECT auth.uid()));
CREATE POLICY own_deck_update ON public.decks FOR UPDATE TO authenticated
  USING (owner_id=(SELECT auth.uid())) WITH CHECK (owner_id=(SELECT auth.uid()));
CREATE POLICY own_deck_delete ON public.decks FOR DELETE TO authenticated
  USING (owner_id=(SELECT auth.uid()));
CREATE POLICY visible_memberships ON public.deck_memberships FOR SELECT TO anon,authenticated
  USING (EXISTS (SELECT 1 FROM public.decks d WHERE d.id=deck_id)
    AND EXISTS (SELECT 1 FROM public.catalog_words w WHERE w.id=word_id));
CREATE POLICY own_membership_insert ON public.deck_memberships FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.decks d WHERE d.id=deck_id AND d.owner_id=(SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.catalog_words w WHERE w.id=word_id));
CREATE POLICY own_membership_delete ON public.deck_memberships FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.decks d WHERE d.id=deck_id AND d.owner_id=(SELECT auth.uid())));
CREATE VIEW public.catalog_decks WITH (security_invoker=true) AS
SELECT d.id,d.title,coalesce(jsonb_agg(m.word_id ORDER BY m.position)
  FILTER (WHERE w.id IS NOT NULL),'[]'::jsonb) AS "wordIds"
FROM public.decks d LEFT JOIN public.deck_memberships m ON m.deck_id=d.id
LEFT JOIN public.catalog_words w ON w.id=m.word_id
GROUP BY d.id,d.title;
-- Supabase may install permissive default grants on public objects: make the
-- boundary explicit instead of relying on a pristine PostgreSQL ACL baseline.
REVOKE ALL ON public.decks,public.deck_memberships,public.catalog_words,public.catalog_decks FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.decks,public.deck_memberships,public.catalog_words,public.catalog_decks TO anon,authenticated;
GRANT INSERT,UPDATE,DELETE ON public.decks TO authenticated;
GRANT INSERT,DELETE ON public.deck_memberships TO authenticated;
GRANT ALL ON public.decks,public.deck_memberships TO service_role;
GRANT SELECT ON public.catalog_words,public.catalog_decks TO service_role;
CREATE INDEX content_revisions_word ON catalog_private.content_revisions(word_id);
CREATE INDEX example_translations_example ON catalog_private.example_translations(example_id);
CREATE INDEX word_examples_example ON catalog_private.word_examples(example_id);
CREATE INDEX deck_memberships_word ON public.deck_memberships(word_id);
CREATE INDEX decks_owner ON public.decks(owner_id);

-- Build the manifest first in the same transaction, then insert its publication.
-- Once sealed, even a service cannot append a new text to an old version.
CREATE FUNCTION catalog_private.guard_manifest() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Serialize manifest writes and sealing for this word. The existence check
  -- alone races with a publication committed by another transaction.
  PERFORM 1 FROM catalog_private.words w WHERE w.id=NEW.word_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM catalog_private.word_publications p
    WHERE p.word_id=NEW.word_id AND p.content_version=NEW.content_version) THEN
    RAISE EXCEPTION 'Publication is sealed' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER sealed_manifest BEFORE INSERT ON catalog_private.publication_items
  FOR EACH ROW EXECUTE FUNCTION catalog_private.guard_manifest();
CREATE TRIGGER serialize_publication BEFORE INSERT ON catalog_private.word_publications
  FOR EACH ROW EXECUTE FUNCTION catalog_private.guard_manifest();

CREATE FUNCTION catalog_private.validate_publication() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE model jsonb; BEGIN
  SELECT v.word INTO model FROM catalog_private.published_word_versions v
    WHERE v.word_id=NEW.word_id AND v.content_version=NEW.content_version;
  IF model IS NULL THEN
    RAISE EXCEPTION 'Publication needs its reviewed word revision and a reviewed translation' USING ERRCODE='23514';
  END IF;
  -- Each manifest entry must have a typed body; hashes alone are not content.
  IF EXISTS (SELECT 1 FROM catalog_private.publication_items i
    WHERE i.word_id=NEW.word_id AND i.content_version=NEW.content_version AND NOT CASE i.kind
      WHEN 'word' THEN i.revision_id=NEW.word_revision_id
      WHEN 'translation' THEN EXISTS (SELECT 1 FROM catalog_private.word_translations t WHERE t.id=i.revision_id)
      WHEN 'example' THEN EXISTS (SELECT 1 FROM catalog_private.examples e WHERE e.id=i.revision_id)
      WHEN 'example_translation' THEN EXISTS (SELECT 1 FROM catalog_private.example_translations t WHERE t.id=i.revision_id)
      WHEN 'association' THEN EXISTS (SELECT 1 FROM catalog_private.word_examples a
        WHERE a.id=i.revision_id AND a.word_revision_id=NEW.word_revision_id)
      ELSE false END) THEN
    RAISE EXCEPTION 'Manifest has an unrelated or missing typed revision' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM catalog_private.publication_items i
    JOIN catalog_private.content_revisions r ON r.id=i.revision_id
    WHERE i.word_id=NEW.word_id AND i.content_version=NEW.content_version
    GROUP BY r.kind,r.entity_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Two revisions of one element in a publication' USING ERRCODE='23514';
  END IF;
  -- No duplicate accepted answer and no silent last-wins translation of an example.
  IF EXISTS (SELECT 1 FROM catalog_private.publication_items i
    JOIN catalog_private.word_translations t ON t.id=i.revision_id
    WHERE i.word_id=NEW.word_id AND i.content_version=NEW.content_version
    GROUP BY t.language,t.text HAVING count(*)>1)
  OR EXISTS (SELECT 1 FROM catalog_private.publication_items i
    JOIN catalog_private.example_translations t ON t.id=i.revision_id
    WHERE i.word_id=NEW.word_id AND i.content_version=NEW.content_version
    GROUP BY t.example_id,t.language HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate published translation' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM catalog_private.publication_items i
      WHERE i.word_id=NEW.word_id AND i.content_version=NEW.content_version AND i.kind='example')
      <> jsonb_array_length(model->'examples')
    OR (SELECT count(*) FROM catalog_private.publication_items i
      WHERE i.word_id=NEW.word_id AND i.content_version=NEW.content_version AND i.kind='association')
      <> jsonb_array_length(model->'examples')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(model->'examples') e GROUP BY e->>'text' HAVING count(*)>1)
    OR EXISTS (SELECT 1 FROM catalog_private.publication_items i
      JOIN catalog_private.example_translations t ON t.id=i.revision_id
      WHERE i.word_id=NEW.word_id AND i.content_version=NEW.content_version
        AND NOT EXISTS (SELECT 1 FROM catalog_private.publication_items e
          WHERE e.word_id=i.word_id AND e.content_version=i.content_version AND e.revision_id=t.example_id)) THEN
    RAISE EXCEPTION 'Example needs a reviewed sense association and translation, without duplicates' USING ERRCODE='23514';
  END IF;
  -- Every included revision retains its own provenance; seed does not invent a
  -- blanket external license for repository material.
  IF EXISTS (SELECT 1 FROM catalog_private.publication_items i
    WHERE i.word_id=NEW.word_id AND i.content_version=NEW.content_version
      AND NOT EXISTS (SELECT 1 FROM catalog_private.content_sources s WHERE s.revision_id=i.revision_id)) THEN
    RAISE EXCEPTION 'Published content needs provenance' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validate_publication AFTER INSERT ON catalog_private.word_publications
  FOR EACH ROW EXECUTE FUNCTION catalog_private.validate_publication();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA catalog_private FROM PUBLIC,anon,authenticated;

-- Attribution is public only for explicitly included revisions of the current
-- publication. Reviewers, candidates and service metadata remain private.
CREATE VIEW public.catalog_sources WITH (security_barrier=true) AS
SELECT i.word_id,i.content_version,i.revision_id,i.kind,s.provider,s.source_id,
  s.source_revision,s.source_url,s.attribution,s.license,s.fetched_at,s.modified
FROM catalog_private.publication_items i
JOIN catalog_private.words w ON w.id=i.word_id AND w.published_version=i.content_version
JOIN catalog_private.content_sources s ON s.revision_id=i.revision_id;
REVOKE ALL ON public.catalog_sources FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.catalog_sources TO anon,authenticated,service_role;

-- The catalog version a client pins as its snapshot (createWordExerciseRegistry), from the latest import.
CREATE VIEW public.catalog_release WITH (security_barrier=true) AS
SELECT catalog_version,seed_version,source_ref,imported_at
FROM catalog_private.catalog_imports ORDER BY imported_at DESC, catalog_version DESC LIMIT 1;
REVOKE ALL ON public.catalog_release FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.catalog_release TO anon,authenticated,service_role;
