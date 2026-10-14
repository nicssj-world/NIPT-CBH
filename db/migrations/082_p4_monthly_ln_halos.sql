-- Owner Lock 2026-10-14: LN Halos YYBYYMMDDNNN, NNN runs across Bangkok calendar month.
-- Additive forward migration: 001–081 checksum history is IMMUTABLE.
-- Keeps receipt-trigger issuance, case/HIS LN, printed identifiers, label layout and audit.
-- Existing immutable numbers are not rewritten. Prior daily allocations (incl retired)
-- seed the monthly counter so newly issued numbers cannot reuse earlier allocations.

CREATE FUNCTION p4_ln_halos_month(d date) RETURNS date LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT date_trunc('month',d::timestamp)::date
$$;

CREATE TABLE ln_halos_monthly_sequence(
  sequence_month date PRIMARY KEY CHECK (extract(day FROM sequence_month)=1),
  last_value integer NOT NULL CHECK (last_value BETWEEN 0 AND 999)
);
REVOKE ALL ON ln_halos_monthly_sequence FROM PUBLIC;

-- Migration to a running synthetic instance must not reset the counter to 001.
-- Count all allocated daily numbers, including retired/deleted numbers.
INSERT INTO ln_halos_monthly_sequence(sequence_month,last_value)
SELECT p4_ln_halos_month(sequence_date),least(999,sum(last_value)::integer)
FROM ln_halos_daily_sequence
GROUP BY 1;

-- The dedicated old daily table remains read-only historical evidence.
-- Receipt now serializes on ONE month row, in the prior audit-chain lock order.
CREATE OR REPLACE FUNCTION p4_ensure_ln_halos(p_round uuid,p_path text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r specimen_round; d date; m date; n integer; code text;
BEGIN
  IF p_path NOT IN ('RECEIPT_TRIGGER','RECEIPT_RECOVERY') THEN RAISE EXCEPTION 'LN_HALOS_ISSUE_PATH_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_round::text,75432810));
  SELECT * INTO r FROM specimen_round WHERE id=p_round;
  IF r.id IS NULL OR r.received_at IS NULL OR r.received_source IS NULL THEN RAISE EXCEPTION 'LN_HALOS_REQUIRES_RECEIPT'; END IF;
  SELECT ln_halos INTO code FROM specimen_lab_number WHERE round_id=p_round;
  IF code IS NOT NULL THEN RETURN code; END IF;
  -- Always lock audit-chain (75432801) BEFORE monthly sequence, preventing deadlocks.
  PERFORM pg_advisory_xact_lock(75432801);
  d:=p4_bangkok_date(now());
  m:=p4_ln_halos_month(d);
  INSERT INTO ln_halos_monthly_sequence(sequence_month,last_value) VALUES(m,0)
    ON CONFLICT(sequence_month) DO NOTHING;
  SELECT last_value INTO n FROM ln_halos_monthly_sequence WHERE sequence_month=m FOR UPDATE;
  IF n>=999 THEN RAISE EXCEPTION 'LN_HALOS_MONTHLY_SEQUENCE_EXHAUSTED'; END IF;
  n:=n+1;
  UPDATE ln_halos_monthly_sequence SET last_value=n WHERE sequence_month=m;
  code:=p4_format_ln_halos(d,n);
  INSERT INTO specimen_lab_number(round_id,case_id,ln_halos,sequence_date,sequence_value,issued_on,issue_path)
    VALUES(r.id,r.case_id,code,d,n,r.received_source,p_path);
  INSERT INTO analytical_attempt(case_id,round_id,attempt_number,state)
    VALUES(r.case_id,r.id,1,'Ready') ON CONFLICT(round_id,attempt_number) DO NOTHING;
  RETURN code;
END $$;

REVOKE ALL ON FUNCTION p4_ensure_ln_halos(uuid,text) FROM PUBLIC;
-- Existing app_rw EXECUTE privilege is preserved on REPLACE; fresh DB role setup
-- runs packages/db/roles.sql after migrations, so do not refer to roles here.
