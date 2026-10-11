import {promises as fs} from 'node:fs';
import {atomicImmutableWrite,confined,sha256} from '../storage';
import {validateOutboundIdentity, type OutboundIdentity} from './identity';
export async function publishSynthetic(
  root: string,
  input: OutboundIdentity & {pdf: Buffer; epoch: number},
  epoch: () => Promise<number>,
  hook?: (stage: string) => Promise<void>,
) {
  // Complete identity and format validation before touching any destination file.
  const {ln} = validateOutboundIdentity(input);
  if (!/^0*99000\d+$/.test(ln) || !/^\d+_SYNTHETIC-[A-Za-z0-9_-]+__\d+\.pdf$/.test(input.pdfName)) {
    throw Error('INVALID_FILENAME');
  }
  if (!input.pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Error('INVALID_PDF');
  const check = async () => { if (await epoch() !== input.epoch) throw Error('CANCELLED'); };
  await check();
  await atomicImmutableWrite(root, input.pdfName, input.pdf);
  await atomicImmutableWrite(root, input.resName, input.res);
  for (const [name, bytes] of [[input.pdfName, input.pdf], [input.resName, input.res]] as const) {
    if (sha256(await fs.readFile(await confined(root, name))) !== sha256(bytes)) throw Error('HASH_MISMATCH');
  }
  await hook?.('before_ok');
  await check();
  await atomicImmutableWrite(root, input.resName.replace(/\.res$/, '.ok'), Buffer.from([255, 254]));
  await hook?.('after_ok');
  if (await epoch() !== input.epoch) return {state: 'RECONCILIATION_REQUIRED', resHash: sha256(input.res), pdfHash: sha256(input.pdf)};
  return {state: 'SIMULATOR_DELIVERED', resHash: sha256(input.res), pdfHash: sha256(input.pdf)};
}
export function clinicalPublish():never{throw Error('P1_CLINICAL_PUBLICATION_PROHIBITED');}
