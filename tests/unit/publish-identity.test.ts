import {describe, expect, it} from 'vitest';
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {publishSynthetic} from '../../packages/integrations/publish';
import {serializeRes, verifyRes} from '../../packages/integrations/res';
import {resInput} from '../helpers/his';

const ln = resInput().ln;
const otherLn = ln + '2';
const encode = (rows: string[][]) => Buffer.concat([
  Buffer.from([255, 254]), Buffer.from(rows.map(r => r.join('|')).join('\r') + '\r', 'utf16le'),
]);
const fixture = () => {
  const res = serializeRes(resInput());
  return {resName: res.filename, res: res.bytes, pdf: Buffer.from('%PDF-1.4 SYNTHETIC'), pdfName: `1_SYNTHETIC-HN-1__${ln}.pdf`, epoch: 0};
};
const alteredRes = (row: number, field: number, value: string) => {
  const rows = verifyRes(fixture().res);
  rows[row][field] = value;
  return encode(rows);
};

describe('publish identity fails before any destination write', () => {
  it.each(['00990000000001', '000990001'])('publishes synthetic LN %s with all leading zeros intact', async value => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nipt-identity-'));
    try {
      const rows = verifyRes(fixture().res);
      rows[1][2] = rows[1][21] = rows[2][2] = value;
      rows[3][11] = value + '118';
      const input = {...fixture(), res: encode(rows), resName: value + '124.res', pdfName: `1_SYNTHETIC-HN-1__${value}.pdf`, expectedLn: value};
      expect((await publishSynthetic(root, input, async () => 0)).state).toBe('SIMULATOR_DELIVERED');
      expect(await readFile(path.join(root, input.resName))).toEqual(input.res);
      expect(await readFile(path.join(root, input.pdfName))).toEqual(input.pdf);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
  it.each([
    ['source LN', {expectedLn: otherLn}, 'SOURCE_LN_MISMATCH'],
    ['PDF LN', {pdfName: `1_SYNTHETIC-HN-1__${otherLn}.pdf`}, 'PDF_LN_MISMATCH'],
    ['RES filename LN', {resName: otherLn + '124.res'}, 'RES_FILENAME_MISMATCH'],
    ['P duplicate LN', {res: alteredRes(1, 21, otherLn)}, 'RES_LN_MISMATCH'],
    ['O LN', {res: alteredRes(2, 2, otherLn)}, 'RES_LN_MISMATCH'],
    ['R accession LN', {res: alteredRes(3, 11, otherLn + '118')}, 'RES_LN_MISMATCH'],
    ['R accession suffix', {res: alteredRes(3, 11, ln + '119')}, 'RES_LN_MISMATCH'],
    ['filename suffix', {resName: ln + '125.res'}, 'RES_FILENAME_MISMATCH'],
    ['missing filename suffix', {resName: ln + '.res'}, 'RES_FILENAME_MISMATCH'],
    ['malformed rows', {res: Buffer.concat([fixture().res, Buffer.from('extra\r', 'utf16le')])}, 'INVALID_RECORD_WIDTH'],
    ['UTF-8 encoding', {res: Buffer.from(fixture().res.subarray(2).toString('utf16le'), 'utf8')}, 'INVALID_BOM'],
    ['invalid UTF-16 surrogate', {res: alteredRes(1, 5, '\ud800')}, 'INVALID_RES_ENCODING'],
  ] as const)('rejects %s, including repeated retries, with no PDF/RES/OK', async (_label, change, code) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nipt-identity-'));
    try {
      const input = {...fixture(), ...change};
      for (let retry = 0; retry < 2; retry++) {
        await expect(publishSynthetic(root, input, async () => 0)).rejects.toThrow(code);
        expect(await readdir(root)).toEqual([]);
      }
      const valid = fixture();
      expect((await publishSynthetic(root, valid, async () => 0)).state).toBe('SIMULATOR_DELIVERED');
      expect(await readFile(path.join(root, valid.resName))).toEqual(valid.res);
      expect(await readFile(path.join(root, valid.pdfName))).toEqual(valid.pdf);
      expect((await readdir(root)).sort()).toEqual([valid.pdfName, valid.resName, valid.resName.replace('.res', '.ok'), 'stage'].sort());
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
