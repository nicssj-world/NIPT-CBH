import {expect,it} from 'vitest';
import {isOtherFiscalYear} from '../../src/components/anc/presentation';
it('keeps all-year queue badges tied to S1, not the selected cohort or a later S2 receipt',()=>{expect(isOtherFiscalYear('2026-09-30T16:59:59.999Z',2570)).toBe(true);expect(isOtherFiscalYear('2026-09-30T17:00:00Z',2570)).toBe(false);expect(isOtherFiscalYear('2026-10-15T00:00:00Z',2569)).toBe(true);expect(isOtherFiscalYear(null,2570)).toBe(false)});
