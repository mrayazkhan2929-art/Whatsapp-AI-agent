-- Additive document lifecycle. Existing chunks and embeddings are never rewritten.
BEGIN;
CREATE TABLE public.knowledge_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES public.organizations(id),
 knowledge_base_id uuid NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 240), enabled boolean NOT NULL DEFAULT true,
 deleted_at timestamptz, latest_version integer NOT NULL DEFAULT 0, current_version_id uuid,
 legacy_key text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.knowledge_document_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES public.organizations(id),
 document_id uuid NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
 version_number integer NOT NULL, status text NOT NULL CHECK(status IN ('queued','parsing','embedding','ready','failed')),
 source_base64 text CHECK(length(source_base64)<=2796204), media_type text NOT NULL,
 source_filename text NOT NULL, source_sha256 text, parsed_text text, chunk_count integer NOT NULL DEFAULT 0,
 embedding_model text, failure_code text, claim_token uuid, lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0, created_by uuid REFERENCES public.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), indexed_at timestamptz,
 UNIQUE(document_id,version_number)
);
ALTER TABLE public.knowledge_documents ADD CONSTRAINT knowledge_current_version_fk FOREIGN KEY(current_version_id) REFERENCES public.knowledge_document_versions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.knowledge_document_chunks (
 chunk_id uuid PRIMARY KEY REFERENCES public.knowledge_chunks(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES public.organizations(id), knowledge_base_id uuid NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
 document_id uuid NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
 version_id uuid NOT NULL REFERENCES public.knowledge_document_versions(id) ON DELETE CASCADE,
 chunk_index integer NOT NULL, UNIQUE(version_id,chunk_index)
);
CREATE INDEX knowledge_documents_scope ON public.knowledge_documents(org_id,knowledge_base_id);
CREATE INDEX knowledge_versions_pending ON public.knowledge_document_versions(status,lease_until) WHERE status IN ('queued','parsing','embedding');
CREATE INDEX knowledge_document_chunks_version ON public.knowledge_document_chunks(org_id,version_id);

-- Backfill only tenant-consistent parents; malformed old links remain intact and unretrievable.
DO $$ DECLARE r record; d uuid; v uuid; BEGIN
 FOR r IN SELECT c.org_id,c.knowledge_base_id,coalesce(nullif(c.metadata->>'document_id',''),c.id::text) legacy_key,
  left(coalesce(nullif(min(c.metadata->>'source'),''),'Legacy knowledge'),240) filename
  FROM public.knowledge_chunks c JOIN public.knowledge_bases k ON k.id=c.knowledge_base_id AND k.org_id=c.org_id
  GROUP BY c.org_id,c.knowledge_base_id,coalesce(nullif(c.metadata->>'document_id',''),c.id::text)
 LOOP
  d:=gen_random_uuid();v:=gen_random_uuid();
  INSERT INTO public.knowledge_documents(id,org_id,knowledge_base_id,filename,latest_version,legacy_key) VALUES(d,r.org_id,r.knowledge_base_id,r.filename,1,r.legacy_key);
  INSERT INTO public.knowledge_document_versions(id,org_id,document_id,version_number,status,media_type,source_filename,embedding_model,indexed_at)
   VALUES(v,r.org_id,d,1,'ready','text/plain',r.filename,'legacy-preserved',now());
  INSERT INTO public.knowledge_document_chunks SELECT c.id,c.org_id,c.knowledge_base_id,d,v,(row_number() OVER(ORDER BY c.created_at,c.id)-1)::int
   FROM public.knowledge_chunks c WHERE c.org_id=r.org_id AND c.knowledge_base_id=r.knowledge_base_id AND coalesce(nullif(c.metadata->>'document_id',''),c.id::text)=r.legacy_key;
  UPDATE public.knowledge_documents SET current_version_id=v WHERE id=d;
  UPDATE public.knowledge_document_versions SET chunk_count=(SELECT count(*) FROM public.knowledge_document_chunks WHERE version_id=v) WHERE id=v;
 END LOOP;
END $$;

CREATE FUNCTION public.guard_knowledge_document_links() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF TG_TABLE_NAME='knowledge_documents' THEN
  IF NOT EXISTS(SELECT 1 FROM knowledge_bases WHERE id=NEW.knowledge_base_id AND org_id=NEW.org_id) THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Knowledge base not found'; END IF;
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM knowledge_document_versions WHERE id=NEW.current_version_id AND document_id=NEW.id AND org_id=NEW.org_id) THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Version not found'; END IF;
 ELSIF TG_TABLE_NAME='knowledge_document_versions' THEN
  IF TG_OP='UPDATE' AND (OLD.status='ready' OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.version_number IS DISTINCT FROM OLD.version_number OR NEW.source_base64 IS DISTINCT FROM OLD.source_base64 OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256 OR NEW.media_type IS DISTINCT FROM OLD.media_type OR NEW.source_filename IS DISTINCT FROM OLD.source_filename) THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Document source/version is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM knowledge_documents WHERE id=NEW.document_id AND org_id=NEW.org_id) THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Document not found'; END IF;
  IF NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND org_id=NEW.org_id AND active) THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Actor not found'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=NEW.document_id AND d.org_id=c.org_id AND d.knowledge_base_id=c.knowledge_base_id
   JOIN knowledge_document_versions v ON v.id=NEW.version_id AND v.document_id=d.id AND v.org_id=d.org_id
   WHERE c.id=NEW.chunk_id AND c.org_id=NEW.org_id AND c.knowledge_base_id=NEW.knowledge_base_id) THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Chunk provenance not found'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER guard_knowledge_documents BEFORE INSERT OR UPDATE ON public.knowledge_documents FOR EACH ROW EXECUTE FUNCTION public.guard_knowledge_document_links();
CREATE TRIGGER guard_knowledge_versions BEFORE INSERT OR UPDATE ON public.knowledge_document_versions FOR EACH ROW EXECUTE FUNCTION public.guard_knowledge_document_links();
CREATE TRIGGER guard_knowledge_chunks BEFORE INSERT OR UPDATE ON public.knowledge_document_chunks FOR EACH ROW EXECUTE FUNCTION public.guard_knowledge_document_links();

-- Compatibility writes create real provenance; commit RPCs supply their version IDs.
CREATE FUNCTION public.adopt_knowledge_chunk() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ DECLARE d uuid; v uuid; BEGIN
 IF NOT EXISTS(SELECT 1 FROM knowledge_bases WHERE id=NEW.knowledge_base_id AND org_id=NEW.org_id) THEN RETURN NEW; END IF;
 IF NEW.metadata ? 'document_version_id' THEN
  v:=(NEW.metadata->>'document_version_id')::uuid;
  SELECT document_id INTO d FROM knowledge_document_versions WHERE id=v AND org_id=NEW.org_id AND status='embedding';
  IF d IS NULL THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Version is not indexing'; END IF;
 ELSE
  d:=gen_random_uuid();v:=gen_random_uuid();
  INSERT INTO knowledge_documents(id,org_id,knowledge_base_id,filename,latest_version,legacy_key) VALUES(d,NEW.org_id,NEW.knowledge_base_id,left(coalesce(NEW.metadata->>'source','Legacy knowledge'),240),1,NEW.id::text);
  INSERT INTO knowledge_document_versions(id,org_id,document_id,version_number,status,media_type,source_filename,chunk_count,embedding_model,indexed_at) VALUES(v,NEW.org_id,d,1,'ready','text/plain',left(coalesce(NEW.metadata->>'source','Legacy knowledge'),240),1,'legacy-preserved',now());
  UPDATE knowledge_documents SET current_version_id=v WHERE id=d;
 END IF;
 INSERT INTO knowledge_document_chunks VALUES(NEW.id,NEW.org_id,NEW.knowledge_base_id,d,v,coalesce((NEW.metadata->>'chunk_index')::int,0));
 RETURN NEW;
END $$;
CREATE TRIGGER adopt_knowledge_chunk AFTER INSERT ON public.knowledge_chunks FOR EACH ROW EXECUTE FUNCTION public.adopt_knowledge_chunk();

CREATE FUNCTION public.begin_knowledge_version(p_org uuid,p_kb uuid,p_document uuid,p_filename text,p_source text,p_media_type text,p_sha256 text,p_actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$ DECLARE d knowledge_documents; v knowledge_document_versions; BEGIN
 -- Serialize tenant admission across different KBs as well as versions of the same document.
 PERFORM pg_advisory_xact_lock(hashtextextended('knowledge-queue:'||p_org::text,0));
 PERFORM 1 FROM knowledge_bases WHERE id=p_kb AND org_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Knowledge base not found'; END IF;
 IF (SELECT count(*) FROM knowledge_document_versions kv JOIN knowledge_documents kd ON kd.id=kv.document_id AND kd.org_id=kv.org_id WHERE kv.org_id=p_org AND kd.deleted_at IS NULL AND kv.status IN ('queued','parsing','embedding'))>=100 THEN RAISE SQLSTATE 'PT429' USING MESSAGE='Document queue is full'; END IF;
 IF p_document IS NULL THEN
  INSERT INTO knowledge_documents(org_id,knowledge_base_id,filename) VALUES(p_org,p_kb,p_filename) RETURNING * INTO d;
 ELSE
  SELECT * INTO d FROM knowledge_documents WHERE id=p_document AND org_id=p_org AND knowledge_base_id=p_kb AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Document not found'; END IF;
 END IF;
 IF d.latest_version>=1000 THEN RAISE SQLSTATE 'PT429' USING MESSAGE='Version limit reached'; END IF;
 INSERT INTO knowledge_document_versions(org_id,document_id,version_number,status,source_base64,media_type,source_filename,source_sha256,created_by)
  VALUES(p_org,d.id,d.latest_version+1,'queued',p_source,p_media_type,p_filename,p_sha256,p_actor) RETURNING * INTO v;
 UPDATE knowledge_documents SET latest_version=v.version_number,updated_at=now() WHERE id=d.id;
 RETURN jsonb_build_object('documentId',d.id,'versionId',v.id,'versionNumber',v.version_number,'status',v.status);
END $$;

CREATE FUNCTION public.claim_knowledge_version(p_org uuid,p_version uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$ DECLARE v knowledge_document_versions; BEGIN
 UPDATE knowledge_document_versions x SET status='parsing',claim_token=p_token,lease_until=now()+interval '10 minutes',attempts=attempts+1,failure_code=NULL
 FROM knowledge_documents d JOIN knowledge_bases k ON k.id=d.knowledge_base_id AND k.org_id=d.org_id
 WHERE x.id=p_version AND x.org_id=p_org AND d.id=x.document_id AND d.org_id=x.org_id AND d.deleted_at IS NULL AND x.attempts<3
  AND (x.status='queued' OR (x.status IN ('parsing','embedding') AND x.lease_until<now())) RETURNING x.* INTO v;
 RETURN CASE WHEN v.id IS NULL THEN NULL ELSE to_jsonb(v) END;
END $$;

CREATE FUNCTION public.finish_knowledge_version(p_org uuid,p_version uuid,p_token uuid,p_text text,p_chunks jsonb,p_model text,p_failure text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$ DECLARE v knowledge_document_versions; d knowledge_documents; c jsonb; idx int:=0; BEGIN
 SELECT * INTO v FROM knowledge_document_versions WHERE id=p_version AND org_id=p_org FOR UPDATE;
 IF NOT FOUND OR v.claim_token IS DISTINCT FROM p_token OR v.status NOT IN ('parsing','embedding') THEN RETURN false; END IF;
 SELECT * INTO d FROM knowledge_documents WHERE id=v.document_id AND org_id=p_org FOR UPDATE;
 IF NOT FOUND OR d.deleted_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM knowledge_bases WHERE id=d.knowledge_base_id AND org_id=p_org) THEN RETURN false; END IF;
 IF p_failure IS NOT NULL THEN
  UPDATE knowledge_document_versions SET status='failed',failure_code=left(p_failure,80),lease_until=NULL WHERE id=v.id; RETURN true;
 END IF;
 IF v.status<>'embedding' OR jsonb_typeof(p_chunks)<>'array' OR jsonb_array_length(p_chunks) NOT BETWEEN 1 AND 200 THEN RAISE SQLSTATE 'PT400' USING MESSAGE='Invalid indexing result'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_chunks) LOOP
  IF length(c->>'content') NOT BETWEEN 1 AND 16000 OR jsonb_array_length(c->'embedding')<>1536 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(c->'embedding') e WHERE e::float<>0) THEN RAISE SQLSTATE 'PT400' USING MESSAGE='Invalid chunk embedding'; END IF;
  INSERT INTO knowledge_chunks(org_id,knowledge_base_id,content,embedding,metadata) VALUES(p_org,d.knowledge_base_id,c->>'content',(c->'embedding')::text::vector(1536),jsonb_build_object('source',d.filename,'document_id',d.id,'document_version_id',v.id,'chunk_index',idx,'total_chunks',jsonb_array_length(p_chunks)));
  idx:=idx+1;
 END LOOP;
 UPDATE knowledge_document_versions SET status='ready',parsed_text=p_text,chunk_count=idx,embedding_model=p_model,indexed_at=now(),lease_until=NULL WHERE id=v.id;
 UPDATE knowledge_documents SET current_version_id=v.id,updated_at=now() WHERE id=d.id AND latest_version=v.version_number;
 RETURN true;
END $$;

CREATE FUNCTION public.normalize_knowledge_text(value text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT lower(translate(regexp_replace(coalesce(value,''),'[ًٌٍَُِّْـ]','','g'),'أإآٱىة','اااايه')) $$;
CREATE INDEX knowledge_chunks_simple_lexical ON public.knowledge_chunks USING gin(to_tsvector('simple',public.normalize_knowledge_text(content)));
CREATE INDEX knowledge_chunks_english_lexical ON public.knowledge_chunks USING gin(to_tsvector('english',content));

CREATE FUNCTION public.search_knowledge_documents(p_org uuid,p_version uuid,p_kb uuid,p_query text,p_embedding vector(1536) DEFAULT NULL,p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid,content text,metadata jsonb,document_id uuid,version_id uuid,version_number integer,chunk_index integer,score float)
LANGUAGE plpgsql STABLE SET search_path=public AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM agent_versions v JOIN agents a ON a.id=v.agent_id AND a.org_id=v.org_id AND a.published_version_id=v.id AND a.active
  JOIN agent_version_knowledge_bases link ON link.version_id=v.id AND link.org_id=v.org_id AND link.agent_id=a.id
  JOIN knowledge_bases k ON k.id=link.knowledge_base_id AND k.org_id=v.org_id WHERE v.id=p_version AND v.org_id=p_org AND k.id=p_kb) THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Published knowledge scope not found'; END IF;
 RETURN QUERY SELECT c.id,c.content,c.metadata,d.id,v.id,v.version_number,l.chunk_index,
  CASE WHEN p_embedding IS NULL THEN greatest(ts_rank_cd(to_tsvector('simple',normalize_knowledge_text(c.content)),plainto_tsquery('simple',normalize_knowledge_text(p_query))),ts_rank_cd(to_tsvector('english',c.content),plainto_tsquery('english',p_query)))::float ELSE 1-(c.embedding<=>p_embedding) END s
 FROM knowledge_chunks c JOIN knowledge_document_chunks l ON l.chunk_id=c.id AND l.org_id=c.org_id AND l.knowledge_base_id=c.knowledge_base_id
 JOIN knowledge_documents d ON d.id=l.document_id AND d.org_id=c.org_id AND d.knowledge_base_id=c.knowledge_base_id AND d.current_version_id=l.version_id
 JOIN knowledge_document_versions v ON v.id=l.version_id AND v.document_id=d.id AND v.org_id=d.org_id AND v.status='ready'
 WHERE c.org_id=p_org AND c.knowledge_base_id=p_kb AND d.enabled AND d.deleted_at IS NULL
 AND CASE WHEN p_embedding IS NULL THEN to_tsvector('simple',normalize_knowledge_text(c.content))@@plainto_tsquery('simple',normalize_knowledge_text(p_query)) OR to_tsvector('english',c.content)@@plainto_tsquery('english',p_query) ELSE c.embedding IS NOT NULL AND 1-(c.embedding<=>p_embedding)>=0.65 END
 ORDER BY s DESC,c.id LIMIT least(greatest(p_limit,1),50);
END $$;

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(query_embedding vector(1536),kb_id uuid,org_id uuid,match_count integer DEFAULT 5,similarity_threshold float DEFAULT 0.65)
RETURNS TABLE(id uuid,content text,metadata jsonb,similarity float) LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT c.id,c.content,c.metadata,1-(c.embedding<=>query_embedding) FROM knowledge_chunks c
 JOIN knowledge_bases k ON k.id=c.knowledge_base_id AND k.org_id=c.org_id
 JOIN knowledge_document_chunks l ON l.chunk_id=c.id AND l.org_id=c.org_id AND l.knowledge_base_id=c.knowledge_base_id
 JOIN knowledge_documents d ON d.id=l.document_id AND d.org_id=c.org_id AND d.knowledge_base_id=c.knowledge_base_id AND d.current_version_id=l.version_id AND d.enabled AND d.deleted_at IS NULL
 JOIN knowledge_document_versions v ON v.id=l.version_id AND v.document_id=d.id AND v.org_id=d.org_id AND v.status='ready'
 WHERE c.org_id=$3 AND c.knowledge_base_id=$2 AND 1-(c.embedding<=>query_embedding)>=similarity_threshold ORDER BY 1-(c.embedding<=>query_embedding) DESC LIMIT least(greatest(match_count,1),50)
$$;

SET CONSTRAINTS ALL IMMEDIATE;
-- All document/chunk changes go through the server lifecycle; tenant SELECT compatibility remains.
REVOKE INSERT,UPDATE,DELETE ON public.knowledge_chunks FROM anon,authenticated;
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_document_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.knowledge_documents,public.knowledge_document_versions,public.knowledge_document_chunks FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.knowledge_documents,public.knowledge_document_versions,public.knowledge_document_chunks TO service_role;
DO $$ DECLARE r record; BEGIN FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('guard_knowledge_document_links','adopt_knowledge_chunk','begin_knowledge_version','claim_knowledge_version','finish_knowledge_version','search_knowledge_documents','match_knowledge_chunks') LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated'; EXECUTE 'GRANT EXECUTE ON FUNCTION '||r.signature||' TO service_role'; END LOOP; END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
