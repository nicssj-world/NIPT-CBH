import {it,expect} from 'vitest';
import {resolveMigrationIdentity} from '../../packages/migration/lineage';
// Synthetic LN Halos only. HALOS writes a twin as "<LN Halos>D-<n>"; the mapping holds the plain LN Halos.
const MAP=['26B990000001','26B990000002'];
it('keeps the ordinary attempt rules unchanged',()=>{
 expect(resolveMigrationIdentity('26B990000001',MAP,[])).toEqual({baseId:'26B990000001',attemptOrdinal:1});
 expect(resolveMigrationIdentity('26B990000001-2',MAP,['26B990000001'])).toEqual({baseId:'26B990000001',attemptOrdinal:2});
 expect(resolveMigrationIdentity('26B990000001-2',MAP,[])).toEqual({baseId:null,attemptOrdinal:null});
});
it('resolves a twin D-n to the original LN Halos only with the plain number mapped and the D form in sampleinfo',()=>{
 expect(resolveMigrationIdentity('26B990000002D-1',MAP,['26B990000002D'])).toEqual({baseId:'26B990000002',attemptOrdinal:1,infoKey:'26B990000002D'});
 expect(resolveMigrationIdentity('26B990000002D-2',MAP,['26B990000002D'])).toMatchObject({baseId:'26B990000002',attemptOrdinal:2});
});
it('never invents a number: unmapped plain number, missing sampleinfo, or a D form that is itself a mapping row stay unresolved or unchanged',()=>{
 expect(resolveMigrationIdentity('26B990000009D-1',MAP,['26B990000009D'])).toEqual({baseId:null,attemptOrdinal:null});
 expect(resolveMigrationIdentity('26B990000002D-1',MAP,[])).toEqual({baseId:null,attemptOrdinal:null});
 expect(resolveMigrationIdentity('26B990000002D-1',[...MAP,'26B990000002D'],['26B990000002D'])).toMatchObject({baseId:'26B990000002D'});
 expect(resolveMigrationIdentity('26B990000002R-1',MAP,['26B990000002R'])).toEqual({baseId:null,attemptOrdinal:null});
});
