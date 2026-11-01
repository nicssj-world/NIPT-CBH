import {type NextRequest} from 'next/server';
import {cancelExecution} from '@/server/migration';
export const runtime='nodejs';
export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){return cancelExecution(request,(await context.params).id);}
