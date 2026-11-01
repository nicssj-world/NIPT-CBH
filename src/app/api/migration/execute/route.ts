import {type NextRequest} from 'next/server';
import {startMigration} from '@/server/migration';
export const runtime='nodejs';
export const POST=(request:NextRequest)=>startMigration(request);
