import {execFileSync} from "node:child_process";
import {readFile,lstat} from "node:fs/promises";
const files=execFileSync("git",["ls-files","--cached","--others","--exclude-standard","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
const failures:string[]=[];
for(const file of files){
 if(/(^|\/)(\.env(\.|$)|data\/|backups\/|NIPTY|NIPT-Audit)|\.(zip|pet|res|ok|pem|key|sqlite|db|docx|xlsx|pdf)$/i.test(file)){if(file!==".env.example")failures.push(`${file}: prohibited artifact`);continue;}
 if((await lstat(file)).size>2_000_000){failures.push(`${file}: oversized source artifact`);continue;}
 const content=await readFile(file,"utf8");
 if(/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)||/(ghp_|github_pat_)[A-Za-z0-9_]{25,}/.test(content)||/AKIA[A-Z0-9]{16}/.test(content))failures.push(`${file}: credential pattern`);
 // Real Thai national-ID validation; synthetic fixture IDs are explicit strings.
 for(const match of content.matchAll(/(?<!\d)([1-8]\d{12})(?!\d)/g)){const v=match[1];const check=(11-[...v.slice(0,12)].reduce((s,d,i)=>s+Number(d)*(13-i),0)%11)%10;if(check===Number(v[12]))failures.push(`${file}: possible real national identifier`);}
}
if(failures.length){process.stderr.write(failures.join("\n")+"\n");process.exitCode=1;}else process.stdout.write(`Source guard PASS: ${files.length} files; prohibited archives, data and credential patterns absent.\n`);
