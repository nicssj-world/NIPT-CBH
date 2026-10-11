import {chown,chmod,mkdir,lstat} from 'node:fs/promises';
for(const root of ['/files','/simulator','/outbound']){await mkdir(root,{recursive:true});if((await lstat(root)).isSymbolicLink())throw Error('SYMLINK_VOLUME');await chown(root,1000,1000);await chmod(root,0o700);}
process.stdout.write('Synthetic volume permissions prepared.\n');
