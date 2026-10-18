import {pool,withTransaction} from '../packages/db/connection';
import {verifyPhotoStorage,backupPhotos,restorePhotos,relocateRoot} from '../packages/run-photos/maintenance';

// Run Photo Evidence maintenance for Hospital IT (run on the application server as the service account that stores photos):
//   npm run photos -- verify                                   database ↔ file consistency (exit 1 when inconsistent)
//   npm run photos -- backup <empty-folder>                    verified copy of every referenced photo file + manifest
//   npm run photos -- restore <backup-folder> <rootId> <path>  put one root's files back (after the database restore)
//   npm run photos -- relocate <rootId> <path> "<reason>"      record that a restored root now lives at <path>
// The database itself is backed up and restored with the existing Backup/Restore tooling (deploy/scripts).
const [command,...args]=process.argv.slice(2);
const out=(v:unknown)=>process.stdout.write(JSON.stringify(v,null,1)+'\n');
try{
 if(command==='verify'){const r=await withTransaction(db=>verifyPhotoStorage(db));out(r);if(!r.consistent)process.exitCode=1;}
 else if(command==='backup'&&args[0])out(await withTransaction(db=>backupPhotos(db,args[0])));
 else if(command==='restore'&&args.length===3)out(await restorePhotos(args[0],args[1],args[2]));
 else if(command==='relocate'&&args.length===3)out(await withTransaction(db=>relocateRoot(db,args[0],args[1],args[2])));
 else{process.stderr.write('usage: verify | backup <folder> | restore <backup> <rootId> <path> | relocate <rootId> <path> <reason>\n');process.exitCode=2;}
}catch(e){process.stderr.write(((e as {code?:string}).code??(e as Error).message)+'\n');process.exitCode=1;}
finally{await pool().end().catch(()=>undefined);}
