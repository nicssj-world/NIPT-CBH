import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
it('combined UAT isolates published ports, project and database from both source previews',()=>{
 const compose=readFileSync('tools/operational/home-uat.compose.yaml','utf8');
 expect(compose).toContain('name: nipt-integrated-owner-uat-20261017');
 expect(compose).toContain('127.0.0.1:19448:443');
 expect(compose).toContain('127.0.0.1:19449:5432');
 expect(compose).toContain('NIPT_OPERATIONAL_DATABASE: nipt_operational_integrated_owner_uat');
 expect(compose).not.toMatch(/19443|19444|19445|19446|19447|nipt_operational_home_uat|nipt-home-operational-uat|nipt-integrated-uat-/);
 expect(compose).toContain('read_only: true');
 expect(compose).toContain('com.docker.network.bridge.enable_ip_masquerade: "false"');
});
it('standalone Web packages the migration inventory required by authenticated Health',()=>{
 const docker=readFileSync('Dockerfile','utf8').split(' AS web')[1].split(' AS operations')[0];
 expect(docker).toContain('/app/db/migrations ./db/migrations');
});
