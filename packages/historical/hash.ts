import {createHash} from 'node:crypto';
/** Recursively key-sorted JSON (arrays keep order). undefined is rejected so a missing value can never hash like null. */
export function canonicalJson(value:unknown):string{
 if(value===undefined)throw new Error('CANONICAL_UNDEFINED');
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('CANONICAL_NON_FINITE');return JSON.stringify(value);}
 if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
 if(typeof value==='object')return `{${Object.keys(value as object).sort().map(k=>`${JSON.stringify(k)}:${canonicalJson((value as Record<string,unknown>)[k])}`).join(',')}}`;
 throw new Error('CANONICAL_UNSUPPORTED');
}
export const sha256Hex=(s:string)=>createHash('sha256').update(s).digest('hex');
export const hashOf=(value:unknown)=>sha256Hex(canonicalJson(value));
