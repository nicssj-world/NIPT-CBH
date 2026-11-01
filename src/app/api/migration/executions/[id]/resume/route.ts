import {type NextRequest} from 'next/server';
import {resumeExecution} from '@/server/migration';
export const runtime='nodejs';
export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){return resumeExecution(request,(await context.params).id);}
