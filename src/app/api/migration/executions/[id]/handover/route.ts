import {type NextRequest} from 'next/server';
import {handoverExecution} from '@/server/migration';
export const runtime='nodejs';
export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){return handoverExecution(request,(await context.params).id);}
