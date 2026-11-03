import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const css=readFileSync('src/components/p2/anc-workspace.css','utf8')+readFileSync('src/components/ui-backlog-polish.css','utf8');
const orderOf=(selector:string)=>{const at=css.indexOf(selector+'{order:');if(at<0)return null;return Number(css.slice(at+selector.length+7).match(/^-?\d+/)![0]);};
it('ANC case page: HIS data, then the NIPT result, ...; the PET evidence is last, after the activity history, and collapsed',()=>{
 const his=orderOf('.case-stage-released>.case-his'),results=orderOf('.case-stage-released>.case-results'),activity=orderOf('.anc-case-workspace>.case-activity-details'),pet=orderOf('.anc-case-workspace>.case-pet-evidence');
 expect(his).toBe(0);expect(results).toBe(1);
 expect(activity).not.toBeNull();expect(pet).not.toBeNull();expect(pet!).toBeGreaterThan(activity!);
 expect(readFileSync('src/components/p2/pet-evidence-panel.tsx','utf8')).toContain('<details className="panel case-pet-evidence">');   // no open attribute: collapsed
 const ws=readFileSync('src/components/p2/case-workspace.tsx','utf8');
 expect(ws.indexOf('<PetEvidencePanel')).toBeGreaterThan(ws.indexOf('case-activity-details'));
});
