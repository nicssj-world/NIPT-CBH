import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
it('owner-local UAT isolates project, ports, networks and database from existing UATs',()=>{
 const compose=readFileSync('tools/operational/home-uat.compose.yaml','utf8');
 expect(compose).toContain('name: nipt-cbh-owner-local-102-20261020');
 expect(compose).toContain('127.0.0.1:19548:443');
 expect(compose).toContain('127.0.0.1:19549:5432');
 expect(compose).toContain('subnet: 10.237.48.0/28');
 expect(compose).toContain('subnet: 10.237.48.16/28');
 expect(compose).toContain('subnet: 10.237.48.32/28');
 expect(compose).toContain('subnet: 10.237.48.48/28');
 expect(compose).toContain('subnet: 10.237.48.64/28');
 expect(compose).toContain('NIPT_OPERATIONAL_DATABASE: nipt_operational_integrated_owner_uat');
 expect(compose).not.toMatch(/19443|19444|19445|19446|19447|19448|19449|nipt_operational_home_uat|nipt-home-operational-uat|nipt-integrated-owner-uat-20261017|nipt-integrated-uat-|10\.237\.(17|18|28|38)\./);
 expect(compose).toContain('read_only: true');
 expect(compose).toContain('com.docker.network.bridge.enable_ip_masquerade: "false"');
});
it('standalone Web packages the migration inventory required by authenticated Health',()=>{
 const docker=readFileSync('Dockerfile','utf8').split(' AS web')[1].split(' AS operations')[0];
 expect(docker).toContain('/app/db/migrations ./db/migrations');
});
