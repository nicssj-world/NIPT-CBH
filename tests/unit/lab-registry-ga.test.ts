import {it,expect} from 'vitest';
import {registryGa} from '../../packages/lab/registry-ga';
it('LAB-02 warns only above 18w0d and leaves unknown blank',()=>{
 expect(registryGa('2027-03-23','2026-10-20')).toEqual({weeks:18,days:0,over18:false});
 expect(registryGa('2027-03-22','2026-10-20')).toEqual({weeks:18,days:1,over18:true});
 expect(registryGa(null,'2026-10-20')).toBeNull();expect(registryGa('2027-03-23',null)).toBeNull();
});
