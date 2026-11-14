/**
 * Gestational-age sources in SQL (Owner 2026-11-14, registry consolidation): the same EDD / collection-date order the ANC overview uses
 * (anc/insights.ts GA_SQL): the newest REQUEST document revision or verified paper request panel, then the Lab paper registration, then the
 * electronic draft; the collection date is the HIS receipt's, else the request's. `r` is the specimen round alias, `w` its p2_workspace alias.
 * The joins add the aliases `ga_reg` and `ga_doc`.
 */
export const gaSourceJoins=(r:string)=>`LEFT JOIN lab_operational_registration ga_reg ON ga_reg.round_id=${r}.id
  LEFT JOIN LATERAL (SELECT x.edd,x.cd FROM (SELECT d.created_at,d.payload->'draft'->'pregnancy'->>'edd' edd,d.payload->'draft'->'pregnancy'->>'collectionDate' cd FROM p2_document_revision d WHERE d.round_id=${r}.id AND d.kind='REQUEST'
    UNION ALL SELECT p.created_at,p.panel->>'edd',p.panel->>'collectionDate' FROM p2_paper_review p WHERE p.round_id=${r}.id AND p.kind='REQUEST' AND p.status='Verified') x WHERE x.edd IS NOT NULL ORDER BY x.created_at DESC LIMIT 1) ga_doc ON true`;
export const gaEddSql=(w:string)=>`COALESCE(ga_doc.edd,ga_reg.edd::text,${w}.draft#>>'{pregnancy,edd}')`;
export const gaCollectionSql=(r:string,w:string)=>`COALESCE(${r}.collection_date::text,ga_doc.cd,${w}.draft#>>'{pregnancy,collectionDate}')`;
/** A text value as a date only when it is a real calendar day (never raises on 2026-02-30); NULL otherwise. */
export const safeDateSql=(x:string)=>`(CASE WHEN (${x}) ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN CASE WHEN substring((${x}),9,2)::int<=extract(day FROM (make_date(substring((${x}),1,4)::int,substring((${x}),6,2)::int,1)+interval '1 month - 1 day')) THEN (${x})::date END END)`;
/** GA in days at the blood draw, NULL when unknown or outside 0-315 days (registryGa's range). */
export const gaDaysSql=(r:string,w:string)=>`(SELECT CASE WHEN g BETWEEN 0 AND 315 THEN g END FROM (SELECT 280+(${safeDateSql(gaCollectionSql(r,w))}-${safeDateSql(gaEddSql(w))}) g) ga_days)`;
