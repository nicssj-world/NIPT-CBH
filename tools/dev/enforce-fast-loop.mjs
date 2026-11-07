// Claude Code and Codex PreToolUse: guide agents back to focused development checks.
// Release scripts/subprocesses keep their own independent safety gates.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const RULES = [
  {
    label: 'direct full npm test',
    pattern: /(?:^|[;&|\n(]\s*)npm(?:\.cmd)?\s+(?:run\s+)?test(?::[\w-]+)?(?=$|[\s;&|)])/im,
    alternative: 'npm run dev:verify or npm run dev:test -- <file>; for release use npm run release:preflight -- --full'
  },
  {
    label: 'direct production build',
    pattern: /(?:^|[;&|\n(]\s*)(?:npm(?:\.cmd)?\s+run\s+build|npx(?:\.cmd)?\s+next\s+build)(?=$|[\s;&|)])/im,
    alternative: 'npm run dev (Hot Reload), then npm run release:preflight before releasing'
  },
  {
    label: 'direct all-suite Vitest',
    pattern: /(?:^|[;&|\n(]\s*)(?:npx(?:\.cmd)?\s+vitest|node(?:\.exe)?\s+\S*vitest(?:\.mjs)?)\s+run(?:\s|$)/im,
    alternative: 'npm run dev:test -- <file> or npm run release:preflight -- --full'
  },
  {
    label: 'direct broad Playwright suite',
    pattern: /(?:^|[;&|\n(]\s*)(?:npx(?:\.cmd)?\s+playwright|node(?:\.exe)?\s+\S*playwright\S*)\s+test(?:\s|$)/im,
    alternative: 'test one Playwright file locally; use risk-based GitHub CI for the full E2E suite'
  },
  {
    label: 'direct installer/package build',
    pattern: /(?:build-package\.ts|build-setup\.ts)/i,
    alternative: 'npm run release:preflight followed by the explicitly approved deploy script'
  },
  {
    label: 'direct Docker rebuild',
    pattern: /(?:^|[;&|\n(]\s*)docker\s+compose\s+up\b[^\n;&|]*--build/i,
    alternative: 'npm run dev (synthetic local stack with Hot Reload)'
  }
];

// This is a developer ergonomics hook, NOT a security boundary or release authorization.
export function assessCommand(command) {
  const value = String(command ?? '').trim();
  if (!value) return null;
  for (const rule of RULES) {
    if (!rule.pattern.test(value)) continue;
    if (rule.label === 'direct all-suite Vitest' || rule.label === 'direct broad Playwright suite') {
      if (/(?:^|\s)(?:\.?\/)?tests?[/\\]\S+\.(?:test|spec)\.[cm]?[jt]sx?(?=\s|$)/i.test(value)) continue;
    }
    return {label: rule.label, alternative: rule.alternative};
  }
  return null;
}
export function hookDecision(command) {
  const result = assessCommand(command);
  if (!result) return null;
  return {hookSpecificOutput:{
    hookEventName:'PreToolUse',
    permissionDecision:'deny',
    permissionDecisionReason:'NIPT FAST_PIPELINE_ENFORCEMENT: ' + result.label + ' should not be used in development. Instead use ' + result.alternative + '. See docs/deployment/FAST-DEVELOPMENT-PIPELINE.md. Release safety checks remain mandatory.'
  }};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const event = JSON.parse(readFileSync(0,'utf8'));
    const result = hookDecision(event?.tool_input?.command);
    if (result) process.stdout.write(JSON.stringify(result)+'\n');
  } catch (error) {
    process.stderr.write('FAST_PIPELINE_HOOK_ERROR: '+error.message+'\n');
    process.exitCode = 2;
  }
}
