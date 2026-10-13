-- P6 sandbox fixtures/journal only. No clinical release authority or prior schema changes.
CREATE TABLE p6_fixture (
 id text PRIMARY KEY CHECK(id ~ '^SYNTHETIC-[A-Za-z0-9_-]+$'),
 sandbox_id text NOT NULL CHECK(sandbox_id ~ '^SYNTHETIC-[A-Za-z0-9_-]+$'),
 draft jsonb NOT NULL, draft_hash text NOT NULL CHECK(draft_hash ~ '^[a-f0-9]{64}$'),
 authority text NOT NULL DEFAULT 'SANDBOX_FIXTURE_ONLY' CHECK(authority='SANDBOX_FIXTURE_ONLY'),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,sandbox_id),
 CHECK(draft->>'fixtureId'=id),
 CHECK(draft->>'origin' IN ('ANC','LAB_DIRECT')),
 CHECK(draft#>>'{input,order,ln}' ~ '^0*99000[0-9]+$'),
 CHECK(draft#>>'{input,order,hn}' ~ '^SYNTHETIC-[A-Za-z0-9_-]+$'),
 CHECK(draft#>>'{profile,syntheticOnly}'='true'),
 CHECK(draft->>'pdfHex' ~ '^255044462d[0-9a-f]+$')
);
CREATE TRIGGER p6_fixture_immutable BEFORE UPDATE OR DELETE ON p6_fixture FOR EACH ROW EXECUTE FUNCTION immutable_row();

CREATE TABLE p6_transfer (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),fixture_id text NOT NULL UNIQUE REFERENCES p6_fixture,
 sandbox_id text NOT NULL,FOREIGN KEY(fixture_id,sandbox_id) REFERENCES p6_fixture(id,sandbox_id),
 authority text NOT NULL DEFAULT 'SANDBOX_FIXTURE_ONLY' CHECK(authority='SANDBOX_FIXTURE_ONLY'),
 clinical_release_id uuid CHECK(clinical_release_id IS NULL),
 ln text NOT NULL CHECK(ln ~ '^0*99000[0-9]+$'),ln_generation integer NOT NULL CHECK(ln_generation>0),
 report_version_id text NOT NULL CHECK(report_version_id ~ '^SYNTHETIC-[A-Za-z0-9_-]+$'),
 sequence integer NOT NULL CHECK(sequence>0),
 res_destination text NOT NULL,pdf_destination text NOT NULL,res_name text NOT NULL,pdf_name text NOT NULL,
 plan jsonb NOT NULL,model jsonb NOT NULL,gate jsonb NOT NULL,revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(sandbox_id,ln,ln_generation,report_version_id),UNIQUE(sandbox_id,ln,ln_generation,sequence),
 UNIQUE(res_destination,res_name),UNIQUE(pdf_destination,pdf_name),
 CHECK(plan->>'mode'='CONTRACT_ONLY' AND model->>'hisConfirmed'='false'),
 CHECK(model->'plan'=plan),CHECK(plan->>'fixtureId'=fixture_id),
 CHECK(plan->>'ln'=ln AND (plan->>'lnGeneration')::integer=ln_generation AND (plan->>'sequence')::integer=sequence),
 CHECK(model->>'state' IN ('PREPARED','PDF_VERIFIED','RES_VERIFIED','BACKUP_VERIFIED','OK_OBSERVED','AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED','UNKNOWN_TIMEOUT','SYNTHETIC_CONFIRMED','CANCELLED','RECONCILIATION_REQUIRED','RETRY_PENDING','FAILED_NEEDS_ADMIN'))
);
CREATE FUNCTION p6_transfer_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'P6_IMMUTABLE_TRANSFER'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.fixture_id,NEW.sandbox_id,NEW.authority,NEW.clinical_release_id,NEW.ln,NEW.ln_generation,NEW.report_version_id,NEW.sequence,NEW.res_destination,NEW.pdf_destination,NEW.res_name,NEW.pdf_name,NEW.plan,NEW.created_at)
     IS DISTINCT FROM (OLD.id,OLD.fixture_id,OLD.sandbox_id,OLD.authority,OLD.clinical_release_id,OLD.ln,OLD.ln_generation,OLD.report_version_id,OLD.sequence,OLD.res_destination,OLD.pdf_destination,OLD.res_name,OLD.pdf_name,OLD.plan,OLD.created_at)
     OR NEW.revision<>OLD.revision+1 OR (NEW.gate->>'epoch')::bigint<(OLD.gate->>'epoch')::bigint
  THEN RAISE EXCEPTION 'P6_IMMUTABLE_TRANSFER'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p6_transfer_guard BEFORE UPDATE OR DELETE ON p6_transfer FOR EACH ROW EXECUTE FUNCTION p6_transfer_guard();

CREATE TABLE p6_transfer_event (
 transfer_id uuid NOT NULL REFERENCES p6_transfer,revision integer NOT NULL CHECK(revision>=0),
 code text NOT NULL CHECK(code ~ '^[A-Z_]+$'),event jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(transfer_id,revision)
);
CREATE TRIGGER p6_event_immutable BEFORE UPDATE OR DELETE ON p6_transfer_event FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE p6_reconciliation (
 transfer_id uuid NOT NULL REFERENCES p6_transfer,evidence_id text NOT NULL CHECK(evidence_id ~ '^SYNTHETIC-[A-Za-z0-9_-]+$'),
 actor_id text NOT NULL CHECK(actor_id ~ '^SYNTHETIC-[A-Za-z0-9_-]+$'),
 resolution text NOT NULL CHECK(resolution IN ('OBSERVED_SANDBOX_DELIVERY','NO_DELIVERY','KEEP_HOLD')),
 pdf_hash text NOT NULL,res_hash text NOT NULL,observed_at bigint NOT NULL CHECK(observed_at>=0),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(transfer_id,evidence_id)
);
CREATE TRIGGER p6_reconciliation_immutable BEFORE UPDATE OR DELETE ON p6_reconciliation FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE p6_worker_heartbeat(worker_id text PRIMARY KEY CHECK(worker_id ~ '^SYNTHETIC-[A-Za-z0-9_-]+$'),observed_at timestamptz NOT NULL DEFAULT now(),details jsonb NOT NULL);
CREATE INDEX p6_transfer_pending ON p6_transfer((model->>'state'),updated_at);
REVOKE ALL ON p6_fixture,p6_transfer,p6_transfer_event,p6_worker_heartbeat,p6_reconciliation FROM PUBLIC;
