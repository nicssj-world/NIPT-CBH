import {type NextRequest} from 'next/server';
import {migrationPreflight} from '@/server/migration';
export const runtime='nodejs';
export const GET=(request:NextRequest)=>migrationPreflight(request);
