import {describe,expect,it} from 'vitest';
import {DEFAULT_FILTERS,filtersQuery,hasFilters,readFilters,registryHref} from '../../src/components/p2/registry-filters';

const read=(q:string)=>readFilters(new URLSearchParams(q));

describe('registry filters in the URL (Owner 2026-11-14)',()=>{
 it('reads known codes and ignores everything else, including any search text',()=>{
  const f=read('status=testing&flag=high_run&unitId=0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b&from=2026-10-01&to=2026-10-31&sort=asc&page=3&pageSize=50&q=0099123456');
  expect(f).toEqual({status:'testing',flag:'high_run',unitId:'0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b',from:'2026-10-01',to:'2026-10-31',sort:'asc',page:3,pageSize:50});
  expect(read('status=drop&flag=x&unitId=1&from=31/10/2569&sort=up&page=-1&pageSize=7')).toEqual(DEFAULT_FILTERS);
 });
 it('writes only what differs from the defaults, so a plain list is /cases',()=>{
  expect(filtersQuery(DEFAULT_FILTERS)).toBe('');
  expect(registryHref({status:'awaiting'})).toBe('/cases?status=awaiting');
  expect(registryHref({flag:'ga18',sort:'asc'})).toBe('/cases?flag=ga18&sort=asc');
  const f=read('status=released&page=2');
  expect(read(filtersQuery(f).slice(1))).toEqual(f);
 });
 it('knows when a filter is on (the clear-all button)',()=>{
  expect(hasFilters(DEFAULT_FILTERS)).toBe(false);
  expect(hasFilters({...DEFAULT_FILTERS,sort:'asc',page:4})).toBe(false);
  expect(hasFilters({...DEFAULT_FILTERS,from:'2026-10-01'})).toBe(true);
 });
});
