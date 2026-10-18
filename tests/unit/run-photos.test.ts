import {describe,it,expect,afterEach} from 'vitest';
import {mkdtemp,rm,writeFile,symlink,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sniffImage,imageSize,safeOriginalName} from '../../packages/run-photos/image';
import {validateRootPath,putPhoto,getPhoto,photoKey,PhotoStorageError,resetPhotoStorageBreaker} from '../../packages/run-photos/store';
import {parseRunQuery} from '../../packages/run-photos/service';
import {syntheticJpeg,PNG_1x1} from '../helpers/photos';

const err=(fn:()=>unknown)=>{try{fn();return 'OK';}catch(e){return e instanceof PhotoStorageError?e.code:String(e);}};
describe('storage path validation (Windows local, UNC, traversal)',()=>{
 it('accepts local Windows folders and UNC shares',()=>{
  expect(validateRootPath('D:\\NIPT-CBH\\RunPhotos','win32',{})).toBe('D:\\NIPT-CBH\\RunPhotos');
  expect(validateRootPath('  D:\\NIPT-CBH\\RunPhotos\\  ','win32',{})).toBe('D:\\NIPT-CBH\\RunPhotos');
  expect(validateRootPath('\\\\LAB-SERVER\\NIPT-Photos','win32',{})).toBe('\\\\LAB-SERVER\\NIPT-Photos');
  expect(validateRootPath('\\\\LAB-SERVER\\NIPT-Photos\\2026','win32',{})).toBe('\\\\LAB-SERVER\\NIPT-Photos\\2026');
  expect(validateRootPath('/srv/nipt/run-photos','linux',{})).toBe('/srv/nipt/run-photos');
 });
 it('refuses relative, traversal, device, reserved and drive-root paths',()=>{
  const cases:Record<string,string>={'RunPhotos':'PATH_NOT_ABSOLUTE','..\\x':'PATH_NOT_ABSOLUTE','D:RunPhotos':'PATH_NOT_ABSOLUTE','D:\\NIPT\\..\\Windows':'PATH_TRAVERSAL','D:\\NIPT\\.\\x':'PATH_TRAVERSAL',
   '\\\\?\\D:\\NIPT':'PATH_DEVICE_NAMESPACE','\\\\.\\PhysicalDrive0':'PATH_DEVICE_NAMESPACE','D:\\NIPT\\CON':'PATH_RESERVED_NAME','D:\\NIPT\\nul.txt':'PATH_RESERVED_NAME','D:\\NIPT\\dir.':'PATH_RESERVED_NAME',
   'D:\\':'PATH_DRIVE_ROOT','D:\\a|b':'PATH_INVALID_CHARACTER','D:\\a\nb':'PATH_CONTROL_CHARACTER','':'PATH_LENGTH','\\\\server':'PATH_NOT_ABSOLUTE'};
  for(const [input,code] of Object.entries(cases))expect([input,err(()=>validateRootPath(input,'win32',{}))]).toEqual([input,code]);
  expect(err(()=>validateRootPath('/srv/../etc','linux',{}))).toBe('PATH_TRAVERSAL');
  expect(err(()=>validateRootPath('/','linux',{}))).toBe('PATH_DRIVE_ROOT');
  expect(err(()=>validateRootPath('D:\\'+'a'.repeat(400),'win32',{}))).toBe('PATH_LENGTH');
 });
 it('never inside folders the web server publishes, and honours the installation allow-list',()=>{
  const p=process.platform;
  expect(err(()=>validateRootPath(path.join(process.cwd(),'public','photos'),p,{}))).toBe('PATH_PUBLISHED_BY_WEB');
  expect(err(()=>validateRootPath(path.join(process.cwd(),'.next','x'),p,{}))).toBe('PATH_PUBLISHED_BY_WEB');
  const env={NIPT_RUN_PHOTO_ALLOWED_ROOTS:'D:\\NIPT-CBH;\\\\LAB-SERVER\\NIPT-Photos'};
  expect(validateRootPath('D:\\NIPT-CBH\\RunPhotos','win32',env)).toBe('D:\\NIPT-CBH\\RunPhotos');
  expect(validateRootPath('\\\\lab-server\\nipt-photos\\x','win32',env)).toBe('\\\\lab-server\\nipt-photos\\x');
  expect(err(()=>validateRootPath('E:\\Elsewhere','win32',env))).toBe('PATH_OUTSIDE_ALLOWED_ROOTS');
  expect(err(()=>validateRootPath('D:\\NIPT-CBH-OTHER','win32',env))).toBe('PATH_OUTSIDE_ALLOWED_ROOTS');
 });
});

describe('content sniffing',()=>{
 it('identifies JPEG, PNG, WebP and HEIC by their bytes and reads the pixel size from the header',()=>{
  const jpeg=syntheticJpeg(4000,3000,64);expect(sniffImage(jpeg)).toBe('image/jpeg');expect(imageSize(jpeg,'image/jpeg')).toEqual({width:4000,height:3000});
  expect(sniffImage(PNG_1x1)).toBe('image/png');expect(imageSize(PNG_1x1,'image/png')).toEqual({width:1,height:1});
  const webp=Buffer.alloc(40);webp.write('RIFF',0);webp.write('WEBP',8);webp.write('VP8X',12);webp.writeUIntLE(1919,24,3);webp.writeUIntLE(1079,27,3);
  expect(sniffImage(webp)).toBe('image/webp');expect(imageSize(webp,'image/webp')).toEqual({width:1920,height:1080});
  const heic=Buffer.alloc(32);heic.writeUInt32BE(24,0);heic.write('ftypheic',4);expect(sniffImage(heic)).toBe('image/heic');expect(imageSize(heic,'image/heic')).toBeNull();
 });
 it('refuses SVG, GIF, HTML, PDF and truncated data',()=>{
  for(const s of ['<svg xmlns="http://www.w3.org/2000/svg"/>      ','GIF89a..............','<!doctype html><html>   ','%PDF-1.7 synthetic.......','\xff\xd8'])expect(sniffImage(Buffer.from(s,'latin1'))).toBeNull();
 });
 it('keeps only a display-safe file name',()=>{
  expect(safeOriginalName('C:\\Users\\lab\\IMG_0001.JPG','image/jpeg')).toBe('IMG_0001.JPG');
  expect(safeOriginalName('../../etc/<x>.jpg','image/jpeg')).toBe('x.jpg');
  expect(safeOriginalName('','image/png')).toBe('photo.png');
 });
 it('parses Run queries',()=>{
  expect(parseRunQuery('12')).toEqual({number:12,year:null});expect(parseRunQuery('Run012/2026')).toEqual({number:12,year:2026});
  expect(parseRunQuery('run 7')).toEqual({number:7,year:null});expect(parseRunQuery('012/2026')).toEqual({number:12,year:2026});
  expect(()=>parseRunQuery('Run-x')).toThrow();
 });
});

describe('content-addressed photo files',()=>{
 let base='';afterEach(async()=>{resetPhotoStorageBreaker();if(base)await rm(base,{recursive:true,force:true});});
 it('writes once, verifies on read and refuses a changed file',async()=>{
  base=await mkdtemp(path.join(os.tmpdir(),'nipt-photo-store-'));const bytes=syntheticJpeg();
  const a=await putPhoto(base,bytes),b=await putPhoto(base,bytes);
  expect(a).toMatchObject({existed:false});expect(b).toMatchObject({hash:a.hash,existed:true});
  expect(await getPhoto(base,a.hash)).toEqual(bytes);
  await writeFile(path.join(base,...photoKey(a.hash).split('/')),Buffer.from('tampered'));
  await expect(getPhoto(base,a.hash)).rejects.toMatchObject({code:'HASH_MISMATCH'});
  await expect(getPhoto(base,'../../etc/passwd')).rejects.toMatchObject({code:'INVALID_HASH'});
 });
 it('reports a vanished root instead of recreating it, and refuses symlinked folders below the root',async()=>{
  base=await mkdtemp(path.join(os.tmpdir(),'nipt-photo-store-'));
  await expect(putPhoto(path.join(base,'missing'),syntheticJpeg())).rejects.toMatchObject({code:'FILE_MISSING'});
  const outside=path.join(base,'outside');await mkdir(outside);await mkdir(path.join(base,'root'));
  try{await symlink(outside,path.join(base,'root','sha256'),'junction');}catch{return;} // symlink creation may need privileges
  await expect(putPhoto(path.join(base,'root'),syntheticJpeg())).rejects.toMatchObject({code:'SYMLINK_PROHIBITED'});
 });
});
