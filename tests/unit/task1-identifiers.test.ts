import {it,expect} from 'vitest';
import {printedSampleId,specimenDisplayCode} from '../../packages/lab/rules';

it('Owner Task 1: shared repeat methods, persistent R, exceptional attempts 5 and 6',()=>{
 const base='26B261023001';
 const cases=[
  {roundNumber:1,attemptNumber:1,repeatLevel:null,overallOrdinal:1,id:base+'-1'},
  {roundNumber:1,attemptNumber:2,repeatLevel:'RE_LIBRARY',overallOrdinal:2,id:base+'-2'},
  {roundNumber:1,attemptNumber:2,repeatLevel:'RE_EXTRACTION',overallOrdinal:2,id:base+'-2'},
  {roundNumber:2,attemptNumber:1,repeatLevel:null,overallOrdinal:3,id:base+'R-1'},
  {roundNumber:2,attemptNumber:2,repeatLevel:'RE_EXTRACTION',overallOrdinal:4,id:base+'R-2'},
  {roundNumber:2,attemptNumber:3,repeatLevel:'RE_LIBRARY',overallOrdinal:5,id:base+'R-1'},
  {roundNumber:3,attemptNumber:1,repeatLevel:null,overallOrdinal:5,id:base+'R-1'},
  {roundNumber:2,attemptNumber:1,repeatLevel:null,overallOrdinal:2,id:base+'R-1'},
  {roundNumber:3,attemptNumber:1,repeatLevel:null,overallOrdinal:3,id:base+'R-1'},
  {roundNumber:3,attemptNumber:2,repeatLevel:'RE_LIBRARY',overallOrdinal:4,id:base+'R-2'},
  {roundNumber:2,attemptNumber:3,repeatLevel:'RE_EXTRACTION',overallOrdinal:4,id:base+'R-2'},
  {roundNumber:99,attemptNumber:1,repeatLevel:null,overallOrdinal:99,id:base+'R-1'},
  {roundNumber:1,attemptNumber:5,repeatLevel:'RE_EXTRACTION',overallOrdinal:5,id:base+'R-1'},
  {roundNumber:3,attemptNumber:2,repeatLevel:'RE_EXTRACTION',overallOrdinal:6,id:base+'R-1'},
 ] as const;
 for(const c of cases)expect(printedSampleId({base,pregnancy:'Singleton',earlierReLibraryCount:0,receivedSource:'HIS_PET_RECEIPT',...c})).toBe(c.id);
 expect(printedSampleId({base,pregnancy:'Twins',earlierReLibraryCount:0,receivedSource:'HIS_PET_RECEIPT',roundNumber:3,attemptNumber:1,repeatLevel:null,overallOrdinal:5})).toBe(base+'DR-1');
 expect(specimenDisplayCode(base,'Twins',true)).toBe(base+'DR');
 expect(printedSampleId({base,pregnancy:'Singleton',earlierReLibraryCount:0,roundNumber:4,attemptNumber:1,repeatLevel:null,overallOrdinal:7,receivedSource:'HIS_PET_RECEIPT'})).toBe(base+'R-1');
 expect(printedSampleId({base,pregnancy:'Singleton',earlierReLibraryCount:1,roundNumber:1,attemptNumber:3,repeatLevel:'RE_LIBRARY',overallOrdinal:3})).toBeNull();
});
