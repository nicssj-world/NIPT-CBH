import {describe, expect, it} from 'vitest';
import {validateOutboundIdentity} from '../../packages/integrations/identity';
import {serializeRes, verifyRes} from '../../packages/integrations/res';
import {resInput} from '../helpers/his';

function fixture(ln = resInput().ln, generatedAt = '20261011123456', suffix = '124') {
  const serialized = serializeRes({...resInput(), generatedAt});
  const rows = verifyRes(serialized.bytes);
  rows[1][2] = rows[1][21] = rows[2][2] = ln;
  rows[3][11] = ln + '118';
  const res = Buffer.concat([Buffer.from([255, 254]), Buffer.from(rows.map(r => r.join('|')).join('\r') + '\r', 'utf16le')]);
  return {res, resName: ln + suffix + '.res', pdfName: `12_SYNTHETIC-HN-1__${ln}.pdf`, expectedLn: ln};
}

describe('legacy outbound filename/wire identity contract', () => {
  it.each(['1', '00990000000001', '000990001', '990001', '000990000000000000000000001'])('keeps exact LN %s without a fixed width or numeric conversion', ln => {
    expect(validateOutboundIdentity(fixture(ln))).toEqual({ln});
  });
  it.each([
    ['20261011000000', '000'], ['20261011090159', '091'],
    ['20261011090900', '099'], ['20261011121000', '120'],
    ['20261011123456', '124'], ['20261011235959', '239'],
  ])('accepts legacy hour/last-minute-digit suffix for %s', (ts, suffix) => {
    const input = fixture(resInput().ln, ts, suffix);
    expect(validateOutboundIdentity(input)).toEqual({ln: resInput().ln});
    expect(serializeRes({...resInput(), generatedAt: ts}).filename).toBe(input.resName);
  });
  it.each(['12', '1234', '999', '124x', '124.res', '', '../124'])('rejects invalid filename suffix %s', suffix => {
    expect(() => validateOutboundIdentity(fixture(resInput().ln, '20261011123456', suffix))).toThrow();
  });
  it('does not normalize leading zeros in PDF, RES filename or source LN', () => {
    const input = fixture('00990000000001');
    expect(() => validateOutboundIdentity({...input, pdfName: '1_SYNTHETIC-HN-1__990000000001.pdf'})).toThrow('PDF_LN_MISMATCH');
    expect(() => validateOutboundIdentity({...input, resName: '990000000001124.res'})).toThrow('RES_FILENAME_MISMATCH');
    expect(() => validateOutboundIdentity({...input, expectedLn: '990000000001'})).toThrow('SOURCE_LN_MISMATCH');
  });
  it.each(['', '20261011', '20261011240000', '20260230123456'])('rejects malformed H timestamp %s', ts => {
    const input = fixture();
    const rows = verifyRes(input.res);
    rows[0][13] = ts;
    const res = Buffer.concat([Buffer.from([255, 254]), Buffer.from(rows.map(r => r.join('|')).join('\r') + '\r', 'utf16le')]);
    expect(() => validateOutboundIdentity({...input, res})).toThrow();
  });
  it.each(['\n', '\0', '\udc00'])('rejects invalid encoding or separators %j', value => {
    const input = fixture();
    const text = input.res.subarray(2).toString('utf16le').replace('SYNTHETIC^^', value + 'SYNTHETIC^^');
    expect(() => validateOutboundIdentity({...input, res: Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')])})).toThrow();
  });
});
