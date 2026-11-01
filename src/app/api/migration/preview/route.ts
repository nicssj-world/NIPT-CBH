import {type NextRequest} from 'next/server';
import {previewMigration} from '@/server/migration';
export const runtime='nodejs';
export const POST=(request:NextRequest)=>previewMigration(request);
