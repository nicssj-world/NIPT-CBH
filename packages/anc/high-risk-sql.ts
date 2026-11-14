// No imports: shared by the ANC queue (anc/service.ts) and the central registry (p2/service.ts) without a module cycle.
/** Owner 2026-11-13: "High Risk" = ANY positive result (High Risk T21/T18/T13, or Detected for XO/XXX/XXY/XYY) in the case's active certified release or in a result
 * already reported by the previous system. One definition for the list filter and for the badge. `caseId` is the SQL expression of the case id. */
export const highRiskSql=(caseId:string)=>`EXISTS(SELECT 1 FROM result_report_version v WHERE v.case_id=${caseId} AND v.kind='RESULT'
   AND (EXISTS(SELECT 1 FROM result_release r WHERE r.version_id=v.id AND r.state='Active') OR EXISTS(SELECT 1 FROM historical_reported_result h WHERE h.version_id=v.id))
   AND (COALESCE((v.parsed->>'abnormal')::boolean,false) OR v.parsed->'results'->'t21'->>'value'='High Risk' OR v.parsed->'results'->'t18'->>'value'='High Risk' OR v.parsed->'results'->'t13'->>'value'='High Risk'
    OR v.parsed->'results'->'xo'->>'value'='Detected' OR v.parsed->'results'->'xxx'->>'value'='Detected' OR v.parsed->'results'->'xxy'->>'value'='Detected' OR v.parsed->'results'->'xyy'->>'value'='Detected'))`;
