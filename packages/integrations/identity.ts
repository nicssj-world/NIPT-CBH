import {resFilename, RES_ACCESSION_SUFFIX, verifyRes} from './res';

export interface OutboundIdentity {
  pdfName: string;
  resName: string;
  res: Buffer;
  expectedLn?: string;
}

/** Filename/wire identity only. PDF body identification remains the AL-5 PIC gate. */
export function validateOutboundIdentity(input: OutboundIdentity): {ln: string} {
  const rows = verifyRes(input.res);
  const ln = rows[1][2];
  if (!/^\d+$/.test(ln)) throw Error('INVALID_RES_LN');
  if (rows[1][21] !== ln || rows[2][2] !== ln || rows[3][11] !== ln + RES_ACCESSION_SUFFIX) {
    throw Error('RES_LN_MISMATCH');
  }
  const pdf = /^\d+_[A-Za-z0-9_-]+__(\d+)\.pdf$/.exec(input.pdfName);
  if (!pdf || !/^\d+\.res$/.test(input.resName)) throw Error('INVALID_FILENAME');
  if (pdf[1] !== ln) throw Error('PDF_LN_MISMATCH');
  // Derive the exact legacy suffix from H[13], never guess the length of LN.
  if (input.resName !== resFilename(ln, rows[0][13])) throw Error('RES_FILENAME_MISMATCH');
  if (input.expectedLn !== undefined && input.expectedLn !== ln) throw Error('SOURCE_LN_MISMATCH');
  return {ln};
}
