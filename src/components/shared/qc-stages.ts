/**
 * Where each QC stage sits in the Lab work (Owner 2026-11-14: show the step, e.g. "QC2 หลัง Pooling"). The stored value stays the code.
 * QC1 / QC2 per the Lab Owner lock (QC measurements of the Library; the Pool after Pooling, F4), QC3 = DNB concentration (F5-07),
 * QC4 = per-lane / per-sample quality after the run (F5-16), Sequencing = the run itself.
 */
export const QC_STAGE_LABEL:Record<string,string>={
 QC1:"QC1 · หลังทำ Library",
 QC2:"QC2 · หลัง Pooling",
 QC3:"QC3 · หลังทำ DNB",
 QC4:"QC4 · หลัง Sequencing",
 SEQUENCING:"Sequencing · ระหว่างเดินเครื่อง",
};
