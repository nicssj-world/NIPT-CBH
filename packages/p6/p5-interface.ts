/** Read-only design reference, NOT an integrated query or a release-authority assertion.
 * Verified against PR #5 head afa660a84217ec58279babd78fbf0426f62ad4d4 on 2026-10-13.
 * Source: db/migrations/050_p5_result_management_synthetic.sql:141-154.
 */
export interface P5ReleaseRowReference {
  readonly id:string;
  readonly version_id:string;
  readonly case_id:string;
  readonly round_id:string;
  readonly kind:'RESULT'|'REDRAW_NOTICE';
  readonly channel:'NIPT_ANC_VIEW';
  readonly epoch:number;
  readonly state:'Active'|'Superseded'|'Voided'|'Withdrawn';
  readonly certified_by:string;
  readonly certified_at:Date;
  readonly synthetic:true;
}

export const P5_REFERENCE = Object.freeze({
  pr:5,
  head:'afa660a84217ec58279babd78fbf0426f62ad4d4',
  releaseTable:'result_release',
  reportTable:'result_report_version',
  epochColumn:'epoch',
  allowedChannel:'NIPT_ANC_VIEW',
  integrated:false,
  releaseHold:true,
} as const);

// Future integration must obtain current authority, lineage, verified original LN/generation,
// current consent, immutable PDF/PIC and certifier HIS mapping in the approved lock order.
// A row satisfying the reference interface alone can never authorize outbound publication.
export interface ReleasedResultReadPort {
  readAuthorizedReleasedResult(releaseId:string):Promise<never>;
}
export const heldReleasedResultReadPort:ReleasedResultReadPort = Object.freeze({
  async readAuthorizedReleasedResult(_releaseId:string):Promise<never> {
    void _releaseId;
    throw Error('P6_INTEGRATION_HOLD_P5_AL5_AL6');
  },
});
