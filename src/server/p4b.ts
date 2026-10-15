import {labDeps} from './p4';
import path from 'node:path';
import {FileStore} from '../../packages/storage';
import {requestF4Pdf} from '../../packages/pdf/f4';
export const f4Deps=()=>({store:new FileStore(path.resolve(/* turbopackIgnore: true */ process.env.FILE_STORE_ROOT||'data/files')),render:requestF4Pdf,native:labDeps().native});
