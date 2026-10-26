import {it,expect} from 'vitest';
import {patientDisplayName} from '../../packages/domain/patient-name';
it('formats HIS surname^^prefix firstname without altering plain ANC names',()=>{expect(patientDisplayName('ทดสอบ^^นางสาว สายใจ')).toBe('นางสาว สายใจ ทดสอบ');expect(patientDisplayName('นางสาว สายใจ ทดสอบ')).toBe('นางสาว สายใจ ทดสอบ');expect(patientDisplayName('')).toBe('');});
