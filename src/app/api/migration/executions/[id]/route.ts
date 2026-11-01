import {type NextRequest} from 'next/server';
import {getExecution} from '@/server/migration';
export const runtime='nodejs';
export async function GET(request:NextRequest,context:{params:Promise<{id:string}>}){return getExecution(request,(await context.params).id);}
