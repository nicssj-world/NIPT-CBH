// GitHub Actions risk routing. Reuse the Production risk classifier unchanged.
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {classifyChange} from '../../deploy/windows/risk-classification.mjs';

export function chooseValidation(files,{manual=false}={}) {
  const risk=classifyChange({files:files.map(path=>({path}))});
  return {level:risk.level,runFull:manual||risk.level!=='LOW',files:risk.files,reasons:risk.reasons};
}
export function changedPaths(base,head) {
  if(!/^[a-f0-9]{40}$/i.test(base??'')||/^0+$/.test(base??'')||!/^[a-f0-9]{40}$/i.test(head??''))return [];
  const output=execFileSync('git',['diff','--name-only','-z',base+'...'+head],{encoding:'utf8'});
  return output.split('\0').filter(Boolean);
}
function main() {
  let paths=[],diffError=null;
  try{paths=changedPaths(process.env.BASE_SHA,process.env.HEAD_SHA);}
  catch(error){diffError=error.message;} // no reliable diff => HIGH
  const plan=chooseValidation(paths,{manual:process.env.GITHUB_EVENT_NAME==='workflow_dispatch'});
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'level='+plan.level+'\nrun_full='+String(plan.runFull)+'\n');
  process.stdout.write(JSON.stringify({base:process.env.BASE_SHA,head:process.env.HEAD_SHA,event:process.env.GITHUB_EVENT_NAME,diffError,...plan})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main();
