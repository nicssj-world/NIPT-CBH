import {it,expect} from 'vitest';
import {migrationChecksumMatches} from '../../tools/migration-checksums';
it('accepts only the independently verified local-UAT 105 CRLF/LF pair without accepting an arbitrary edit',()=>{
 const name='105_dcc_consent_runtime_provenance.sql',crlf='08c73fa1057aa3aadaa1b9420bd97499f0375dfa1e1691c6e480af389bdf8d80',lf='b6707b701768d27b13eb70d2330489b8d5e66603008ef344abbaf71c53bb9f7c';
 expect(migrationChecksumMatches(name,lf,crlf)).toBe(true);
 expect(migrationChecksumMatches(name,crlf,lf)).toBe(true);
 expect(migrationChecksumMatches(name,'a'.repeat(64),crlf)).toBe(false);
 expect(migrationChecksumMatches('106_direct_administration.sql',lf,crlf)).toBe(false);
});

it('accepts the CRLF ledger / LF checkout pair for local-UAT migrations 131-133 only, never an arbitrary edit',()=>{
 for(const [name,crlf,lf] of [['131_anc_pet_current_identity.sql','f6efe10ae2efe18f894a9a5b73eb75226036578db5b1835394c9bbc141c3bc90','f4f6f69235354289d20354f1a1ee6d06df5810a1f2c4c53bd76030719644981e'],['132_anc_own_profile.sql','6a71c7fb2f34fa1614ce6f4b8a0a7aeff3c37751c733afae9a0bde422dc06ad5','e746aa2695413ec322b75a283aedaaa90cb049060aa1a2f45e499354bf66a7f9'],['133_restore_pet_clinical_lineage.sql','91b7ca62c53cacbc99ac28c75be85d74305b10876b6fc926920ebc3348e82c1e','973d39043ee6a608cecb3e1af7d48ecf360543b393d5d70afff3ef20e73d01c8']] as const){
  expect(migrationChecksumMatches(name,lf,crlf)).toBe(true);expect(migrationChecksumMatches(name,crlf,lf)).toBe(true);
  expect(migrationChecksumMatches(name,'b'.repeat(64),crlf)).toBe(false);expect(migrationChecksumMatches('134_anc_consent_phone_dependency.sql',lf,crlf)).toBe(false);}
});
