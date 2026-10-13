import {readFileSync, readdirSync} from 'node:fs';
import ts from 'typescript';
import {describe,expect,it} from 'vitest';
import {heldReleasedResultReadPort,P5_REFERENCE} from '../../packages/p6/p5-interface';

describe('P6 isolation and closed P5 integration boundary',()=>{
  it('contains only pure contract dependencies and no dynamic imports or runtime registration',()=>{
    const root=new URL('../../packages/p6/',import.meta.url);
    const allowed=new Set(['node:crypto','zod','../integrations/res','../integrations/pet','./res']);
    for(const name of readdirSync(root).filter(n=>n.endsWith('.ts'))){
      const file=ts.createSourceFile(name,readFileSync(new URL(name,root),'utf8'),ts.ScriptTarget.Latest,true);
      const visit=(node:ts.Node)=>{
        if(ts.isImportDeclaration(node))expect(allowed.has((node.moduleSpecifier as ts.StringLiteral).text),name).toBe(true);
        if(ts.isCallExpression(node))expect(['import','require','eval','Function'].includes(node.expression.getText(file)),name).toBe(false);
        ts.forEachChild(node,visit);
      };visit(file);
    }
  });
  it('P5 reference remains released-view-only and the read port always fails closed',async()=>{
    expect(P5_REFERENCE.head).toBe('afa660a84217ec58279babd78fbf0426f62ad4d4');
    expect(P5_REFERENCE.allowedChannel).toBe('NIPT_ANC_VIEW');expect(P5_REFERENCE.releaseHold).toBe(true);expect(P5_REFERENCE.integrated).toBe(false);
    for(const id of ['SYNTHETIC-RELEASE-1','', 'arbitrary'])await expect(heldReleasedResultReadPort.readAuthorizedReleasedResult(id)).rejects.toThrow('P6_INTEGRATION_HOLD_P5_AL5_AL6');
  });
});
