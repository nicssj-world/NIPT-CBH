import {it,expect} from 'vitest';
import {labNumberMatches} from '../../packages/results/service';

// Owner 2026-11-10: the PDF of a repeat run prints "26B261020101-2"; the sample is "26B261020101-1" / "26B261020101".
it('a run suffix does not make it another sample, but another number still mismatches',()=>{
 const own=['26B261020101-1','26B261020101','2629370031'];
 expect(labNumberMatches('26B261020101-2',own)).toBe(true);
 expect(labNumberMatches('26B261020101-1',own)).toBe(true);
 expect(labNumberMatches('26B261020101',own)).toBe(true);
 expect(labNumberMatches('26B261020102-2',own)).toBe(false);
 expect(labNumberMatches('2629370031',own)).toBe(true);
 expect(labNumberMatches('26B261020101-2',[null,null,'2629370031'])).toBe(false);
});
