import {createHash} from 'node:crypto';
import {crc32, deflateRawSync} from 'node:zlib';
import {zipEntries, zipRead} from '../results/zip';

export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export const xmlEscape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export const xmlDecode = (value: string) => value.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1),16) : Number(n))).replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&apos;',"'").replaceAll('&amp;','&');

/** Bounded in-memory OOXML package. No paths are extracted or executed. */
export function readArchive(bytes: Buffer): Map<string, Buffer> {
  const entries = zipEntries(bytes);
  if (new Set(entries.map(e => e.name)).size !== entries.length) throw new Error('WORKBOOK_DUPLICATE_PART');
  return new Map(entries.map(entry => [entry.name, zipRead(bytes, entry)]));
}

/** Native OPC serializer. Unchanged XML/media bytes remain identical, rather than round-tripping through a spreadsheet model. */
export function writeArchive(parts: ReadonlyMap<string, Buffer>): Buffer {
  const files: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const [path, bytes] of parts) {
    if (!/^[\w\-./\[\]]+$/.test(path) || path.includes('..')) throw new Error('WORKBOOK_INVALID_PART_NAME');
    const name = Buffer.from(path), packed = deflateRawSync(bytes), checksum = crc32(bytes) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(0x800,6); local.writeUInt16LE(8,8);
    local.writeUInt16LE(33,12); local.writeUInt32LE(checksum,14); local.writeUInt32LE(packed.length,18); local.writeUInt32LE(bytes.length,22); local.writeUInt16LE(name.length,26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0x800,8); central.writeUInt16LE(8,10);
    central.writeUInt16LE(33,14); central.writeUInt32LE(checksum,16); central.writeUInt32LE(packed.length,20); central.writeUInt32LE(bytes.length,24); central.writeUInt16LE(name.length,28); central.writeUInt32LE(offset,42);
    files.push(local,name,packed); directory.push(central,name); offset += local.length + name.length + packed.length;
  }
  const cd = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(parts.size,8); end.writeUInt16LE(parts.size,10); end.writeUInt32LE(cd.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...files,cd,end]);
}
