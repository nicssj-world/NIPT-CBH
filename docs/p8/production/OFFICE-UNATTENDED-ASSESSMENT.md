# Word / Excel for a 24-hour unattended installation - assessment and Blocker

Question (Owner gate 3): can the installed system restart (power loss, Windows Update) and keep producing the native NIPT PDF (Word) and the Task List /
master PDFs (Excel) **without staff leaving a Windows session logged in**?

## What was proven (build host: Windows 11 Home, non-elevated, interactive session)

| Proof | Result |
|---|---|
| Word renders a document with name, professional licence number and **two signature images** (Reported-by / Approved-by) through the production renderer (`packages/readygen/native-word.ts`) | PASS - `office-check` step `word_synthetic_signers`: 1 page, 4 image objects (2 PNGs with alpha = image + soft mask) |
| The real Owner SINGLETON master is filled by the production filler with synthetic signers and rendered by Word | PASS - `word_report_master_fill`: 1 page, 7 image objects |
| Signer blocks in the **final** native PDF show name + licence + the stored signature image at both positions, for two signers and for one person chosen twice | PASS - `tests/contracts/owner-lab-054-signers-native.test.ts` (real Word; part of the full vitest run on the frozen source) |
| Excel renders the installed approved master through the production Task List path (3 Task List sheets x 2 pages, QC 1 page / 48 formulas, Pooling 1 page / 101 formulas, 1 page) | PASS - `excel_master_task_pdf` (the two `#DIV/0!` in the empty Pooling template are the template's own and are reported, not failures) |
| The same checks run from the **installed** runtime (`nipt.cmd office-check`), also after the services were stopped and started again only by Task Scheduler | PASS - see `PRODUCTION-REHEARSAL-EVIDENCE.md` steps P07/P10/P15 |
| `host-check` and install `preflight` now check Word as well as Excel, and report whether Windows automatic sign-in is configured (read-only, no password read) | PASS |

## What could NOT be proven here

| Needed for unattended 24 h | Why it is unproven |
|---|---|
| Services and Office return **after a real reboot with nobody signed in** | The host cannot be rebooted unattended by this session, and no automatic sign-in exists on it |
| A startup task with stored credentials (`Register-ScheduledTask ... -LogonType S4U/Password`) or SYSTEM | `Register-ScheduledTask` for any principal other than the interactive current user returns **Access is denied** without elevation (probed) |
| Word/Excel running with no interactive desktop | Microsoft does not support Office automation in session 0 / SYSTEM; `-TaskMode user` alone does **not** solve it: the user's session must exist |

## Options considered (smallest safe first)

1. **Dedicated account + Windows automatic sign-in + `-TaskMode user` (existing method, no new code)** - after a reboot Windows signs the account in by itself, the "at logon" task starts
   the supervisor in that interactive session, and Word/Excel work there. Costs: hospital IT must enable automatic sign-in (credential stored on the machine, physical-access risk) and lock the screen.
   This is the recommended topology and is documented; it needs **a reboot test on the target machine**.
2. SYSTEM task + Excel bridge (existing): the bridge still needs a signed-in user session for Excel, and there is **no Word bridge**; it adds a second moving part and does not remove the session requirement.
3. Run Office in session 0 (desktop-heap/registry workarounds): unsupported by Microsoft, fragile after Office updates - rejected.
4. Replace Word/Excel with a non-Office renderer: changes the signed PDF's fidelity (the Owner locked native Word/Excel) - rejected; not a "smallest" change.
5. Build a stored-password task registrar: new credential-handling surface; needs elevation to test - not done.

## Verdict

**Blocker B-1: unattended Office after reboot is unproven.** The Production Installer is therefore **not declared Production READY**, and no Setup EXE is delivered under that claim.
Closing B-1 needs exactly one on-site test (hospital IT, target machine): configure the dedicated account and automatic sign-in, reboot, wait for the sign-in, run `nipt.cmd office-check`
(must return `ok:true`) and `nipt.cmd health`. If hospital policy forbids automatic sign-in, the fallback is a staffed-session procedure (an operator signs the dedicated account in after any restart);
PDF export is unavailable until then, all other functions keep running.

Behaviour while no interactive session exists was **not exercised** (this session cannot remove its own desktop). Expect PDF requests to fail while the web/worker/renderer and database stay up;
`office-check` is the diagnostic, and the hospital reboot test must record what the application shows in that state.
