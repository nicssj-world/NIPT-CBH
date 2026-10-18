import {z} from 'zod';

/** Page sizes offered in every list that uses the shared pager. A module may pick another default (the Lab worklist uses 50 because a
 * Run holds 48 samples) but never an arbitrary size: the API rejects anything outside this set so a query can never be unbounded. */
export const PAGE_SIZES=[25,50,100] as const;
export type PageSize=typeof PAGE_SIZES[number];

/** zod fragment: `page` (1-based) and `pageSize` restricted to PAGE_SIZES. Query-string numbers arrive as strings, hence coerce. */
export const pageFields=(defaultSize:PageSize=25,sizes:readonly number[]=PAGE_SIZES)=>({
 page:z.coerce.number().int().min(1).max(1000000).default(1),
 pageSize:z.coerce.number().int().refine(v=>sizes.includes(v),'PAGE_SIZE_INVALID').default(defaultSize)});

export type PageMeta={number:number;size:number;total:number;totalPages:number};
/** Last page that can hold rows: at least 1, so an empty list is "page 1 of 1" and never an error. */
export const totalPagesOf=(total:number,size:number)=>Math.max(1,Math.ceil(total/size));
/** A request past the end (a row left the list, or a stale link) is answered with the last real page instead of an empty one. */
export function clampPage(requested:number,total:number,size:number):PageMeta{
 const totalPages=totalPagesOf(total,size),number=Math.min(Math.max(1,requested),totalPages);
 return {number,size,total,totalPages};
}
export const offsetOf=(meta:Pick<PageMeta,'number'|'size'>)=>(meta.number-1)*meta.size;
/** Escapes LIKE metacharacters so a search term is matched literally ("_" and "%" are legal in an LN or name). */
export const likeContains=(term:string)=>'%'+term.replace(/[\\%_]/g,m=>'\\'+m)+'%';
