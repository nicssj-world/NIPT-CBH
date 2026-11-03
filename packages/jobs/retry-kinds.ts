/**
 * Job kinds whose handler can be run again without a possible second external effect: a scan or parse of local evidence, a PDF render,
 * a settings test, and the reservation of a transfer (one transfer per release is unique in the database). The actual HIS transmission
 * is not a pg-boss job: it lives in p6_transfer with its own state machine and is never retried from here.
 * NOT retry-safe, never offered: synthetic_export (writes to an outbound folder), synthetic_outbound_retry (HIS retry has its own guard),
 * synthetic_historical_stage (historical migration staging).
 * Pure data: the page uses it to hide the option, the Worker uses it to decide.
 */
export const RETRY_SAFE_KINDS=['synthetic_scan','synthetic_inbound_test','synthetic_pdf','synthetic_settings_test',
 'synthetic_result_test_path','synthetic_result_scan','synthetic_result_preview','synthetic_result_parse','result_release_completed'] as const;
