import {inflateRawSync,crc32} from 'node:zlib';

// Read-only ZIP reader for result files (NIPTY formats: ZIP-as-PDF with manifest/1.txt, and batch ZIPs of PDFs — Plan §11.1, F-08).
// Nothing is ever written to disk. Encrypted, ZIP64, multi-disk, unknown methods, oversized or high-ratio entries are refused.
export const ZIP_LIMITS={entries:200,entryBytes:25*1024*1024,totalBytes:60*1024*1024,ratio:200} as const;
export type ZipEntry={name:string;method:number;compressedSize:number;size:number;crc:number;offset:number};
export class ZipError extends Error{}
const fail=(code:string):never=>{throw new ZipError(code);};
export const isZip=(bytes:Uint8Array)=>bytes.length>=4&&bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===0x03&&bytes[3]===0x04;

export function zipEntries(bytes:Buffer):ZipEntry[]{
 if(!isZip(bytes))fail('ZIP_SIGNATURE');
 let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 if(eocd<0)fail('ZIP_DIRECTORY_MISSING');
 const disk=bytes.readUInt16LE(eocd+4),cdDisk=bytes.readUInt16LE(eocd+6),count=bytes.readUInt16LE(eocd+10),cdSize=bytes.readUInt32LE(eocd+12),cdOffset=bytes.readUInt32LE(eocd+16);
 if(disk!==0||cdDisk!==0||count===0xffff||cdOffset===0xffffffff)fail('ZIP_MULTIDISK_OR_ZIP64');
 if(count>ZIP_LIMITS.entries)fail('ZIP_TOO_MANY_ENTRIES');
 if(cdOffset+cdSize>eocd)fail('ZIP_DIRECTORY_INVALID');
 const entries:ZipEntry[]=[];let p=cdOffset,total=0;
 for(let i=0;i<count;i++){
  if(p+46>eocd||bytes.readUInt32LE(p)!==0x02014b50)fail('ZIP_DIRECTORY_INVALID');
  const flags=bytes.readUInt16LE(p+8),method=bytes.readUInt16LE(p+10),crc=bytes.readUInt32LE(p+16),compressedSize=bytes.readUInt32LE(p+20),size=bytes.readUInt32LE(p+24);
  const nameLength=bytes.readUInt16LE(p+28),extraLength=bytes.readUInt16LE(p+30),commentLength=bytes.readUInt16LE(p+32),offset=bytes.readUInt32LE(p+42);
  if(flags&1)fail('ZIP_ENCRYPTED');
  if(compressedSize===0xffffffff||size===0xffffffff||offset===0xffffffff)fail('ZIP_MULTIDISK_OR_ZIP64');
  const name=bytes.subarray(p+46,p+46+nameLength).toString(flags&0x800?'utf8':'latin1');
  if(!name||/[\0\r\n]/.test(name))fail('ZIP_ENTRY_NAME_INVALID');
  p+=46+nameLength+extraLength+commentLength;
  if(name.endsWith('/'))continue;
  if(![0,8].includes(method))fail('ZIP_METHOD_UNSUPPORTED');
  if(size>ZIP_LIMITS.entryBytes)fail('ZIP_ENTRY_TOO_LARGE');
  if(compressedSize>0&&size/compressedSize>ZIP_LIMITS.ratio)fail('ZIP_RATIO_UNSAFE');
  total+=size;if(total>ZIP_LIMITS.totalBytes)fail('ZIP_TOTAL_TOO_LARGE');
  entries.push({name,method,compressedSize,size,crc,offset});
 }
 return entries;
}

export function zipRead(bytes:Buffer,entry:ZipEntry):Buffer{
 const p=entry.offset;if(p+30>bytes.length||bytes.readUInt32LE(p)!==0x04034b50)fail('ZIP_LOCAL_HEADER_INVALID');
 const start=p+30+bytes.readUInt16LE(p+26)+bytes.readUInt16LE(p+28),end=start+entry.compressedSize;if(end>bytes.length)fail('ZIP_TRUNCATED');
 const raw=bytes.subarray(start,end);
 let out:Buffer;try{out=entry.method===0?Buffer.from(raw):inflateRawSync(raw,{maxOutputLength:entry.size});}catch{return fail('ZIP_INFLATE_FAILED');}
 if(out.length!==entry.size||(crc32(out)>>>0)!==(entry.crc>>>0))fail('ZIP_CRC_MISMATCH');
 return out;
}
/** Last path segment of a member name, used only for display/provenance; members are never extracted to disk. */
export const memberBasename=(name:string)=>name.split(/[\\/]/).filter(Boolean).pop()??name;
