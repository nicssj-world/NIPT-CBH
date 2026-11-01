import {lstat,readdir,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {parsePet,type Pet} from '../integrations/pet';
import {classifyPet,MAX_PET_BYTES,sectionOf} from '../inbound/wire';
import {isZip,zipRead,type ZipEntry} from '../results/zip';
import {canonical,hash} from './model';
export const HISTORICAL_PET_LIMITS={files:100000,depth:32,archiveBytes:64*1024*1024,archiveEntries:20000,archiveTotalBytes:128*1024*1024,totalReadBytes:512*1024*1024} as const;
export type PetCandidate={sourceName:string;relativePath:string;sha256:string;byteLength:number;bytes:Buffer;pet:Pet};
export type PetSourceIssue={code:string;sourceName:string;relativePath?:string};
export type PetScanResult={candidates:PetCandidate[];issues:PetSourceIssue[];filesSeen:number};
const unsafe=(name:string)=>!name||/[\u0000-\u001f]/.test(name)||name.includes('\\')||name.startsWith('/')||/^[a-z]:/i.test(name)||name.split('/').some(s=>s==='..'||s==='.'||s.includes(':'));
function parseCandidate(sourceName:string,relativePath:string,bytes:Buffer,result:PetScanResult){
 const filename=relativePath.split('/').at(-1)!;if(sectionOf(filename)?.section!=='7')return;
 if(bytes.length>MAX_PET_BYTES){result.issues.push({code:'PET_TOO_LARGE',sourceName,relativePath});return;}
 if(classifyPet(bytes)==='NOT_NIPT')return;
 try{const pet=parsePet(bytes,filename);result.candidates.push({sourceName,relativePath,sha256:hash(bytes),byteLength:bytes.length,bytes,pet});}catch{result.issues.push({code:'PET_PARSE_REVIEW',sourceName,relativePath});}
}
/** Dedicated historical archive bounds: 137 PET+OK pairs already exceed the workbook/PDF reader's 200-entry cap. */
function petArchiveEntries(bytes:Buffer):ZipEntry[]{
 if(!isZip(bytes))throw Error('PET_ARCHIVE_SIGNATURE');let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}if(end<0)throw Error('PET_ARCHIVE_DIRECTORY_MISSING');
 const count=bytes.readUInt16LE(end+10),directoryBytes=bytes.readUInt32LE(end+12),directoryStart=bytes.readUInt32LE(end+16);if(bytes.readUInt16LE(end+4)!==0||bytes.readUInt16LE(end+6)!==0||bytes.readUInt16LE(end+8)!==count||count===0xffff||directoryStart===0xffffffff)throw Error('PET_ARCHIVE_MULTIDISK_OR_ZIP64');if(count>HISTORICAL_PET_LIMITS.archiveEntries)throw Error('PET_ARCHIVE_TOO_MANY_ENTRIES');if(directoryStart+directoryBytes>end)throw Error('PET_ARCHIVE_DIRECTORY_INVALID');
 let p=directoryStart,total=0;const entries:ZipEntry[]=[];
 for(let n=0;n<count;n++){if(p+46>directoryStart+directoryBytes||bytes.readUInt32LE(p)!==0x02014b50)throw Error('PET_ARCHIVE_DIRECTORY_INVALID');const flags=bytes.readUInt16LE(p+8),method=bytes.readUInt16LE(p+10),crc=bytes.readUInt32LE(p+16),compressedSize=bytes.readUInt32LE(p+20),size=bytes.readUInt32LE(p+24),nameLength=bytes.readUInt16LE(p+28),extraLength=bytes.readUInt16LE(p+30),commentLength=bytes.readUInt16LE(p+32),offset=bytes.readUInt32LE(p+42);const next=p+46+nameLength+extraLength+commentLength;if(next>directoryStart+directoryBytes)throw Error('PET_ARCHIVE_DIRECTORY_INVALID');const name=bytes.subarray(p+46,p+46+nameLength).toString(flags&0x800?'utf8':'latin1');p=next;if(flags&1)throw Error('PET_ARCHIVE_ENCRYPTED');if([compressedSize,size,offset].includes(0xffffffff))throw Error('PET_ARCHIVE_MULTIDISK_OR_ZIP64');if(![0,8].includes(method))throw Error('PET_ARCHIVE_METHOD_UNSUPPORTED');if(size>25*1024*1024||compressedSize===0&&size>0||compressedSize>0&&size/compressedSize>200)throw Error('PET_ARCHIVE_ENTRY_SIZE_OR_RATIO_UNSAFE');total+=size;if(total>HISTORICAL_PET_LIMITS.archiveTotalBytes)throw Error('PET_ARCHIVE_TOTAL_TOO_LARGE');if(!name.endsWith('/'))entries.push({name,method,crc,compressedSize,size,offset});}
 if(p!==directoryStart+directoryBytes)throw Error('PET_ARCHIVE_DIRECTORY_INVALID');return entries;
}
/** In-memory only, bounded ZIP. Reject path traversal and UNIX symlink metadata; no extraction. */
export function readPetArchive(bytes:Buffer,sourceName:string):PetScanResult{
 if(bytes.length>HISTORICAL_PET_LIMITS.archiveBytes)throw Error('PET_ARCHIVE_TOO_LARGE');
 const entries=petArchiveEntries(bytes),seen=new Set<string>();
 // zipEntries validates directory bounds; inspect every central record including directory metadata.
 let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 let p=bytes.readUInt32LE(eocd+16);const count=bytes.readUInt16LE(eocd+10);
 for(let i=0;i<count;i++){const nameLength=bytes.readUInt16LE(p+28),extraLength=bytes.readUInt16LE(p+30),commentLength=bytes.readUInt16LE(p+32),name=bytes.subarray(p+46,p+46+nameLength).toString(bytes.readUInt16LE(p+8)&0x800?'utf8':'latin1');if(unsafe(name))throw Error('PET_ARCHIVE_UNSAFE_PATH');if(((bytes.readUInt32LE(p+38)>>>16)&0xf000)===0xa000)throw Error('PET_ARCHIVE_SYMLINK');const key=name.toLowerCase();if(seen.has(key))throw Error('PET_ARCHIVE_DUPLICATE_PATH');seen.add(key);p+=46+nameLength+extraLength+commentLength;}
 const result:PetScanResult={candidates:[],issues:[],filesSeen:entries.length};
 for(const e of entries){if(!/\.pet$/i.test(e.name)||sectionOf(e.name.split('/').at(-1)!)?.section!=='7')continue;if(!seen.has(e.name.replace(/\.pet$/i,'.ok').toLowerCase())){result.issues.push({code:'PET_OK_PENDING',sourceName,relativePath:e.name});continue;}parseCandidate(sourceName,e.name,zipRead(bytes,e),result);}
 return result;
}
/** Caller supplies an authorized configured directory. Walk ALL days; no clock/lookback, writes or symlink following. */
export async function scanHistoricalPetFolder(root:string):Promise<PetScanResult>{
 const absolute=path.resolve(root);if((await lstat(absolute)).isSymbolicLink())throw Error('PET_ROOT_SYMLINK');const base=await realpath(absolute);const result:PetScanResult={candidates:[],issues:[],filesSeen:0};let readBytes=0;
 const contained=(p:string)=>{const relative=path.relative(base,p);return relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative));};
 async function visit(directory:string,depth:number):Promise<void>{if(depth>HISTORICAL_PET_LIMITS.depth){result.issues.push({code:'PET_DEPTH_LIMIT',sourceName:root});return;}let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch{result.issues.push({code:'PET_DIRECTORY_READ_FAILED',sourceName:root});return;}entries.sort((a,b)=>a.name.localeCompare(b.name));
 const names=new Set(entries.filter(e=>e.isFile()).map(e=>e.name.toLowerCase()));for(const e of entries){if(++result.filesSeen>HISTORICAL_PET_LIMITS.files)throw Error('PET_SCAN_FILE_LIMIT');const full=path.join(directory,e.name),relativePath=path.relative(base,full).split(path.sep).join('/');if(e.isSymbolicLink()){result.issues.push({code:'PET_SYMLINK_SKIPPED',sourceName:root,relativePath});continue;}if(e.isDirectory()){if(!contained(await realpath(full)))throw Error('PET_PATH_ESCAPE');await visit(full,depth+1);continue;}if(!e.isFile()||!(/\.pet$/i.test(e.name)||/\.zip$/i.test(e.name)))continue;
 if(/\.pet$/i.test(e.name)){if(sectionOf(e.name)?.section!=='7')continue;if(!names.has(e.name.replace(/\.pet$/i,'.ok').toLowerCase())){result.issues.push({code:'PET_OK_PENDING',sourceName:root,relativePath});continue;}}
 try{const stat=await lstat(full);if(stat.isSymbolicLink()||!stat.isFile()||!contained(await realpath(full)))throw Error('PET_UNSAFE_FILE');const limit=/\.zip$/i.test(e.name)?HISTORICAL_PET_LIMITS.archiveBytes:MAX_PET_BYTES;if(stat.size>limit)throw Error('PET_FILE_TOO_LARGE');readBytes+=stat.size;if(readBytes>HISTORICAL_PET_LIMITS.totalReadBytes)throw Error('PET_TOTAL_READ_LIMIT');const bytes=await readFile(full);if(bytes.length!==stat.size||bytes.length>limit)throw Error('PET_FILE_CHANGED');if(/\.zip$/i.test(e.name)){const archive=readPetArchive(bytes,relativePath);result.candidates.push(...archive.candidates);result.issues.push(...archive.issues);}else parseCandidate(root,relativePath,bytes,result);}catch(e){if(e instanceof Error&&e.message==='PET_TOTAL_READ_LIMIT')throw e;result.issues.push({code:e instanceof Error&&e.message.startsWith('PET_')?e.message:'PET_FILE_READ_FAILED',sourceName:root,relativePath});}
 }}await visit(base,0);const reconciled=reconcilePetCandidates(result.candidates);return {...result,candidates:reconciled.candidates,issues:[...result.issues,...reconciled.issues]};
}
/** No last-write/name/order winner for conflicting HIS identities or clinical order facts. */
export function reconcilePetCandidates(candidates:PetCandidate[]){const groups=new Map<string,PetCandidate[]>(),resolved:PetCandidate[]=[],issues:PetSourceIssue[]=[];for(const c of candidates)groups.set(c.pet.ln,[...(groups.get(c.pet.ln)??[]),c]);for(const rows of groups.values()){const unique=[...new Map(rows.map(r=>[r.sha256,r])).values()];const identities=new Set(unique.map(r=>canonical({hn:r.pet.hn,name:r.pet.name,dob:r.pet.dob,sex:r.pet.sex,ward:r.pet.ward,receivedAt:r.pet.receivedAt,specimenAt:r.pet.specimenAt,orderAt:r.pet.orderAt,identity:r.pet.identity})));if(identities.size>1){issues.push({code:'PET_LN_IDENTITY_CONFLICT',sourceName:rows[0].sourceName,relativePath:rows[0].relativePath});continue;}resolved.push(unique[0]);}return {candidates:resolved,issues};}


