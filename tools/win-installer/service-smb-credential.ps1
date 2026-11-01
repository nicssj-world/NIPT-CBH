<#
.SYNOPSIS  Runs AS THE SERVICE IDENTITY (started by its own scheduled task through nipt-admin): stores one SMB credential in that
           identity's Windows Credential Manager, from a request an administrator protected with DPAPI (machine scope).
.DESCRIPTION
  Nobody stores the service account's password, so an operator cannot sign in as it to run cmdkey. The request file is the hand-over:
  the administrator types the HIS share password into an elevated prompt, the prompt protects it (never plaintext on disk, in a
  command line or in a log) and writes the request to <root>\run (writable only by Administrators, SYSTEM and the service identity).
  nipt-admin validates the request (fresh, this machine, safe target names), then runs this script, which:
    1. reads and DELETES the request, so the protected blob does not linger even when a later step fails;
    2. decrypts it in memory only;
    3. writes a Domain Password credential per target with CredWrite, the call cmdkey itself uses, so the password is in no command line;
    4. writes a result file (identity, targets, user): never the password.
  The credential then lives in the service identity's own vault, DPAPI-protected by that account's password: no other account can read it.
#>
param([Parameter(Mandatory)][string]$Request, [Parameter(Mandatory)][string]$Result)
$ErrorActionPreference = 'Stop'
$res = [ordered]@{ at = (Get-Date).ToString('o'); identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name; ok = $false }
$plain = $null
try {
  $req = [IO.File]::ReadAllText($Request) | ConvertFrom-Json
  Remove-Item -LiteralPath $Request -Force
  if ($req.version -ne 1) { throw 'SMB_REQUEST_VERSION' }
  foreach ($t in @($req.targets)) { if ($t -notmatch '^[A-Za-z0-9]([A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$') { throw 'SMB_REQUEST_TARGETS' } }
  if ($req.user -notmatch '^[A-Za-z0-9._$@\\-]{1,100}$') { throw 'SMB_REQUEST_USER' }
  Add-Type -AssemblyName System.Security
  $plain = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([string]$req.protected), $null, [Security.Cryptography.DataProtectionScope]::LocalMachine))
  Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class NiptCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob;
    public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredWriteW(ref CREDENTIAL c, uint flags);
  public static void Write(string target, string user, string password) {
    byte[] blob = Encoding.Unicode.GetBytes(password);
    IntPtr p = Marshal.AllocHGlobal(blob.Length);
    try {
      Marshal.Copy(blob, 0, p, blob.Length);
      var c = new CREDENTIAL { Type = 2, TargetName = target, UserName = user, CredentialBlobSize = (uint)blob.Length, CredentialBlob = p, Persist = 2 };
      if (!CredWriteW(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { for (int i = 0; i < blob.Length; i++) Marshal.WriteByte(p, i, 0); Marshal.FreeHGlobal(p); Array.Clear(blob, 0, blob.Length); }
  }
}
'@
  foreach ($t in @($req.targets)) { [NiptCred]::Write($t, [string]$req.user, $plain) }
  $res.ok = $true; $res.targets = @($req.targets); $res.user = [string]$req.user
  $res.persisted = @(cmdkey.exe /list | Select-String -SimpleMatch ('target=' + $req.targets[0])).Count -gt 0
} catch { $res.error = $_.Exception.Message }
finally { $plain = $null }
[IO.File]::WriteAllText($Result, ($res | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
if (-not $res.ok) { exit 1 }
