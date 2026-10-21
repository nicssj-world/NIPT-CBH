import {it,expect} from 'vitest';
import {migrationChecksumMatches} from '../../tools/migration-checksums';
it('accepts only the independently verified local-UAT 105 CRLF/LF pair without accepting an arbitrary edit',()=>{
 const name='105_dcc_consent_runtime_provenance.sql',crlf='08c73fa1057aa3aadaa1b9420bd97499f0375dfa1e1691c6e480af389bdf8d80',lf='b6707b701768d27b13eb70d2330489b8d5e66603008ef344abbaf71c53bb9f7c';
 expect(migrationChecksumMatches(name,lf,crlf)).toBe(true);
 expect(migrationChecksumMatches(name,crlf,lf)).toBe(true);
 expect(migrationChecksumMatches(name,'a'.repeat(64),crlf)).toBe(false);
 expect(migrationChecksumMatches('106_direct_administration.sql',lf,crlf)).toBe(false);
});
