import {type NextRequest} from 'next/server';
import {patchRecord} from '@/server/migration';
export const runtime='nodejs';
export async function PATCH(request:NextRequest,context:{params:Promise<{id:string}>}){return patchRecord(request,(await context.params).id);}
