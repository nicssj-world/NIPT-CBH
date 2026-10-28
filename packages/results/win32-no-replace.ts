import {spawn} from 'node:child_process';
import path from 'node:path';

/**
 * Windows SMB-compatible same-directory atomic promotion using Win32
 * MoveFileExW(MOVEFILE_WRITE_THROUGH) WITHOUT MOVEFILE_REPLACE_EXISTING.
 * On another platform this is never executed. PowerShell runs under the
 * exact archive worker identity; the paths are supplied via stdin, not code.
 * Destination conflicts are not treated as permission failures.
 */
export async function moveNoReplaceWin32(stage:string,dest:string):Promise<'MOVED'|'EXISTS'>{
 if(process.platform!=='win32')throw Error('ARCHIVE_PUBLICATION_UNSUPPORTED');
 if(path.dirname(path.resolve(stage)).toLowerCase()!==path.dirname(path.resolve(dest)).toLowerCase())
  throw Error('ARCHIVE_PUBLICATION_UNSUPPORTED');
 // Static PowerShell script. No user-controlled file path is interpreted as PowerShell source.
 const ps=String.raw`
$ErrorActionPreference = 'Stop'
try {
 Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class NiptArchiveNative {
 [DllImport("kernel32.dll", EntryPoint = "MoveFileExW", CharSet = CharSet.Unicode, SetLastError = true)]
 public static extern bool Move(string existingName, string newName, uint flags);
}
'@
 $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
 $ok = [NiptArchiveNative]::Move([string]$inputData.stage,[string]$inputData.dest,8)
 if ($ok) { [Console]::Out.Write('MOVED'); exit 0 }
 $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
 if ($errorCode -eq 80 -or $errorCode -eq 183) { [Console]::Out.Write('EXISTS'); exit 0 }
 [Console]::Error.Write('WIN32_'+$errorCode); exit 2
} catch {
 [Console]::Error.Write('PS_EXCEPTION_'+$_.Exception.GetType().Name)
 exit 2
}
`;
 const encoded=Buffer.from(ps,'utf16le').toString('base64');
 const exe=path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 return new Promise<'MOVED'|'EXISTS'>((resolve,reject)=>{
  const child=spawn(exe,['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{
   windowsHide:true,stdio:['pipe','pipe','pipe'],env:process.env});
  let output='',errorText='',done=false;
  const fail=()=>{if(!done){done=true;const suffix=process.env.NODE_ENV==='test'?':'+errorText.slice(0,60).replace(/[^A-Za-z0-9_]/g,''):'';reject(Error('ARCHIVE_PUBLICATION_UNSUPPORTED'+suffix));}};
  const timer=setTimeout(()=>{child.kill();fail();},20000);
  child.stdout.setEncoding('utf8');child.stdout.on('data',v=>{if(output.length<100)output+=String(v);});
  child.stderr.setEncoding('utf8');child.stderr.on('data',v=>{if(errorText.length<120)errorText+=String(v);});
  child.on('error',()=>{clearTimeout(timer);fail();});
  child.on('close',code=>{clearTimeout(timer);if(done)return;
   if(code===0&&['MOVED','EXISTS'].includes(output.trim())){done=true;resolve(output.trim() as 'MOVED'|'EXISTS');}
   else fail();
  });
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({stage,dest}));
 });
}
