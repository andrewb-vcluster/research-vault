#!/usr/bin/env node
// Codex event adapter. The Claude handlers remain the single implementation of
// vault operations; only payload normalization and output aggregation live here.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isInsideVault } from '../bin/lib/containment.mjs';
import { resolveVault } from '../bin/lib/resolve.mjs';
import { findProjectConfig } from '../bin/lib/projectconfig.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HANDLERS = { SessionStart: 'session-start.mjs', PreToolUse: 'pre-web.mjs', PostToolUse: 'post-tool-use.mjs', Stop: 'stop-gate.mjs' };

export function editedPaths(evt) {
  const input = evt.tool_input;
  const candidates = [];
  if (input?.file_path) candidates.push(input.file_path);
  if (evt.tool_name === 'apply_patch') {
    const patch = typeof input === 'string' ? input : input?.command ?? input?.input ?? input?.patch;
    if (typeof patch !== 'string' || !patch.startsWith('*** Begin Patch')) throw new Error('unrecognized apply_patch payload; run lint/check explicitly');
    for (const m of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)\r?$/gm)) candidates.push(m[1].replace(/\r$/, ''));
  }
  if (candidates.some(p => typeof p !== 'string' || p.includes('\0'))) throw new Error('invalid edited path');
  const cwd = resolve(evt.cwd || process.cwd());
  return [...new Set(candidates.map(p => resolve(cwd, p)))];
}

export function adaptCodex(event, evt, { invoke, now = Date.now } = {}) {
  if (!Object.hasOwn(HANDLERS, event) && event !== 'Dependencies') throw new Error(`unknown hook event: ${event}`);
  const cwd = resolve(evt.cwd || process.cwd());
  const messages = [], context = [];
  const start = now();
  const call = invoke ?? ((file, payload, timeout) => {
    const result = spawnSync(process.execPath, [file, ...(event === 'Dependencies' ? ['--hook'] : [])], { input: JSON.stringify(payload), encoding: 'utf8', cwd, timeout, maxBuffer: 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'hook handler failed');
    return result.stdout.trim();
  });
  let payloads = [{ ...evt, cwd }];
  if (event === 'PostToolUse' || event === 'Dependencies') {
    const paths = editedPaths(evt);
    if (!paths.length) return { systemMessage: 'research-vault: no edited paths supplied; run lint/check explicitly.' };
    const hit = findProjectConfig(cwd);
    const project = hit ? dirname(hit.path) : cwd;
    const vault = resolveVault({ cwd }).path;
    if (paths.some(p => !isInsideVault(project, p) && !isInsideVault(vault, p))) throw new Error('edited path escapes project and vault');
    payloads = paths.map(file_path => ({ ...evt, cwd, tool_name: 'Write', tool_input: { file_path } }));
  }
  for (const payload of payloads) {
    const remaining = 25000 - (now() - start);
    if (remaining <= 0) throw new Error('hook time budget exhausted; run lint/check explicitly');
    const output = call(event === 'Dependencies' ? join(ROOT, 'scripts/deps.mjs') : join(ROOT, 'hooks', HANDLERS[event]), payload, remaining);
    if (!output) continue;
    let data;
    try { data = JSON.parse(output); } catch {
      if (event === 'SessionStart') context.push(output);
      else throw new Error('invalid hook output');
      continue;
    }
    if (event === 'Stop') return data;
    if (data.systemMessage) messages.push(data.systemMessage);
    if (data.hookSpecificOutput?.additionalContext) context.push(data.hookSpecificOutput.additionalContext);
  }
  if (event === 'SessionStart') context.push('research-vault (Codex): search the vault explicitly before web research; hosted web search may not invoke local hooks. Read the bound vault AGENTS.md before writing.');
  return {
    ...(messages.length ? { systemMessage: messages.join('\n') } : {}),
    ...(context.length ? { hookSpecificOutput: { hookEventName: event === 'Dependencies' ? 'PostToolUse' : event, additionalContext: [...new Set(context)].join('\n') } } : {}),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const evt = JSON.parse(readFileSync(0, 'utf8') || '{}');
    console.log(JSON.stringify(adaptCodex(process.argv[2] || evt.hook_event_name, evt)));
  } catch (err) {
    console.log(JSON.stringify({ systemMessage: `research-vault Codex hook skipped: ${err.message}` }));
  }
}
