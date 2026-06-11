#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const rl   = require('readline/promises');

// ── Colour helpers (no deps) ─────────────────────────────────────────────────
const c = {
  reset:  s => `\x1b[0m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
};

const REPO_ROOT  = path.resolve(__dirname, '..');
const CLAUDE_DIR = path.join(os.homedir(), '.claude-alex');
const ENV_FILE   = path.join(CLAUDE_DIR, '.env');
const SETTINGS   = path.join(CLAUDE_DIR, 'settings.json');

// Directories copied recursively (skip if target file already exists — user is prompted)
const INSTALL_DIRS  = ['hooks', 'skills', 'agents', 'scripts'];
const NEVER_INSTALL = new Set(['.env', 'secrets', 'bin', 'node_modules', 'package.json', 'package-lock.json']);

// ── Utilities ────────────────────────────────────────────────────────────────
function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** Walk src dir, return list of { src, dest, exists } */
function collectFiles(srcDir, destDir) {
  const results = [];
  if (!fs.existsSync(srcDir)) return results;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(s, d));
    } else {
      results.push({ src: s, dest: d, exists: fs.existsSync(d) });
    }
  }
  return results;
}

// ── Settings merge ───────────────────────────────────────────────────────────
function mergeSettings(existing, incoming) {
  const out = JSON.parse(JSON.stringify(existing));

  // env — add keys not already present
  if (incoming.env) {
    out.env = out.env || {};
    for (const [k, v] of Object.entries(incoming.env)) {
      if (!(k in out.env)) out.env[k] = v;
    }
  }

  // permissions.allow — union
  if (incoming.permissions?.allow) {
    out.permissions          = out.permissions          || {};
    out.permissions.allow    = out.permissions.allow    || [];
    const existing = new Set(out.permissions.allow);
    for (const p of incoming.permissions.allow) {
      if (!existing.has(p)) out.permissions.allow.push(p);
    }
  }

  // hooks — append entries whose command string isn't already present
  if (incoming.hooks) {
    out.hooks = out.hooks || {};
    for (const [event, matchers] of Object.entries(incoming.hooks)) {
      out.hooks[event] = out.hooks[event] || [];
      const existingCmds = new Set(
        out.hooks[event].flatMap(m => (m.hooks || []).map(h => h.command))
      );
      for (const matcher of matchers) {
        const cmds = (matcher.hooks || []).map(h => h.command);
        if (!cmds.some(cmd => existingCmds.has(cmd))) {
          out.hooks[event].push(matcher);
        }
      }
    }
  }

  // enabledPlugins — incoming wins only for keys not already set
  if (incoming.enabledPlugins) {
    out.enabledPlugins = { ...incoming.enabledPlugins, ...out.enabledPlugins };
  }

  // preferences — same: existing takes priority
  if (incoming.preferences) {
    out.preferences = { ...incoming.preferences, ...out.preferences };
  }

  return out;
}

/** Return a human-readable summary of what mergeSettings would add */
function diffSummary(existing, merged) {
  const lines = [];

  // env additions
  const newEnv = Object.keys(merged.env || {}).filter(k => !(k in (existing.env || {})));
  if (newEnv.length) lines.push(`  ${c.green('+')} env vars: ${newEnv.join(', ')}`);

  // permission additions
  const existAllow = new Set((existing.permissions?.allow) || []);
  const newPerms = (merged.permissions?.allow || []).filter(p => !existAllow.has(p));
  if (newPerms.length) lines.push(`  ${c.green('+')} permissions.allow: ${newPerms.join(', ')}`);

  // hook additions
  for (const [event, matchers] of Object.entries(merged.hooks || {})) {
    const existCmds = new Set(
      ((existing.hooks || {})[event] || []).flatMap(m => (m.hooks || []).map(h => h.command))
    );
    for (const matcher of matchers) {
      for (const h of (matcher.hooks || [])) {
        if (!existCmds.has(h.command)) {
          lines.push(`  ${c.green('+')} hooks.${event}: ${h.command.replace(/\$HOME/g, '~')}`);
        }
      }
    }
  }

  return lines;
}

// ── Prompts ──────────────────────────────────────────────────────────────────
async function ask(iface, question, fallback = '') {
  const answer = (await iface.question(question)).trim();
  return answer === '' ? fallback : answer;
}

async function confirm(iface, question, def = true) {
  const hint = def ? 'Y/n' : 'y/N';
  const answer = (await iface.question(`${question} ${c.dim(`[${hint}]`)} `)).trim().toLowerCase();
  if (answer === '') return def;
  return answer.startsWith('y');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const iface = rl.createInterface({ input: process.stdin, output: process.stdout });

  console.log();
  console.log(c.bold(c.cyan('  ╔══════════════════════════════════════╗')));
  console.log(c.bold(c.cyan('  ║   metameg Claude Code config setup   ║')));
  console.log(c.bold(c.cyan('  ╚══════════════════════════════════════╝')));
  console.log();
  console.log(`  Installing into: ${c.bold(CLAUDE_DIR)}`);
  console.log();

  const claudeExists = fs.existsSync(CLAUDE_DIR);
  if (!claudeExists) {
    console.log(c.yellow('  ~/.claude does not exist — it will be created.\n'));
    ensureDir(CLAUDE_DIR);
  }

  // ── 1. Directories ─────────────────────────────────────────────────────────
  console.log(c.bold('  Step 1/4 — Copy hooks, skills, agents, scripts'));
  console.log();

  let newFiles      = [];
  let conflicting   = [];

  for (const dir of INSTALL_DIRS) {
    const src  = path.join(REPO_ROOT, dir);
    const dest = path.join(CLAUDE_DIR, dir);
    const files = collectFiles(src, dest);
    newFiles.push(...files.filter(f => !f.exists));
    conflicting.push(...files.filter(f => f.exists));
  }

  if (newFiles.length) {
    console.log(`  ${c.green(newFiles.length + ' new files')} will be added.`);
  }

  if (conflicting.length) {
    console.log(`  ${c.yellow(conflicting.length + ' files already exist')} at the destination:`);
    for (const f of conflicting) {
      console.log(`    ${c.dim(f.dest.replace(os.homedir(), '~'))}`);
    }
    console.log();
  }

  const proceedDirs = await confirm(iface, '  Copy files?');
  if (!proceedDirs) {
    console.log(c.dim('  Skipping file copy.'));
  } else {
    let overwriteAll = false;
    if (conflicting.length) {
      overwriteAll = await confirm(iface, '  Overwrite existing files?', false);
    }

    let copied = 0, skipped = 0;
    for (const { src, dest, exists } of [...newFiles, ...conflicting]) {
      if (exists && !overwriteAll) { skipped++; continue; }
      ensureDir(path.dirname(dest));
      fs.copyFileSync(src, dest);
      copied++;
    }
    console.log(`  ${c.green('✓')} Copied ${copied} file(s)${skipped ? `, skipped ${skipped}` : ''}.`);
  }

  // ── 2. settings.json ───────────────────────────────────────────────────────
  console.log();
  console.log(c.bold('  Step 2/4 — Merge settings.json'));
  console.log();

  const incomingSettings = readJSON(path.join(REPO_ROOT, 'settings.json'));
  if (!incomingSettings) {
    console.log(c.dim('  No settings.json in repo — skipping.'));
  } else {
    const existingSettings = readJSON(SETTINGS) || {};
    const merged   = mergeSettings(existingSettings, incomingSettings);
    const summary  = diffSummary(existingSettings, merged);

    if (!summary.length) {
      console.log(c.dim('  settings.json is already up to date — nothing to add.'));
    } else {
      console.log('  Changes that would be merged:\n');
      summary.forEach(l => console.log(l));
      console.log();

      const proceedSettings = await confirm(iface, '  Apply these changes to settings.json?');
      if (proceedSettings) {
        // Backup first
        const backup = SETTINGS + '.bak';
        if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, backup);
        writeJSON(SETTINGS, merged);
        console.log(`  ${c.green('✓')} settings.json updated${fs.existsSync(backup) ? ` (backup → ${backup.replace(os.homedir(), '~')})` : ''}.`);
      } else {
        console.log(c.dim('  Skipping settings.json merge.'));
      }
    }
  }

  // ── 3. CLAUDE.md ───────────────────────────────────────────────────────────
  console.log();
  console.log(c.bold('  Step 3/4 — CLAUDE.md'));
  console.log();

  const srcClaude  = path.join(REPO_ROOT, 'CLAUDE.md');
  const destClaude = path.join(CLAUDE_DIR, 'CLAUDE.md');

  if (!fs.existsSync(srcClaude)) {
    console.log(c.dim('  No CLAUDE.md in repo — skipping.'));
  } else if (!fs.existsSync(destClaude)) {
    fs.copyFileSync(srcClaude, destClaude);
    console.log(`  ${c.green('✓')} CLAUDE.md installed.`);
  } else {
    console.log('  CLAUDE.md already exists. Choose an action:');
    console.log(`    ${c.cyan('1')}  Append repo's CLAUDE.md as a new section`);
    console.log(`    ${c.cyan('2')}  Overwrite`);
    console.log(`    ${c.cyan('3')}  Skip`);
    const choice = (await iface.question('  Choice [1/2/3]: ')).trim();
    if (choice === '1') {
      const addition = '\n\n---\n<!-- metameg claude-config -->\n' + fs.readFileSync(srcClaude, 'utf8');
      fs.appendFileSync(destClaude, addition);
      console.log(`  ${c.green('✓')} Appended to CLAUDE.md.`);
    } else if (choice === '2') {
      fs.copyFileSync(srcClaude, destClaude);
      console.log(`  ${c.green('✓')} CLAUDE.md overwritten.`);
    } else {
      console.log(c.dim('  Skipping CLAUDE.md.'));
    }
  }

  // ── 4. .env secrets ────────────────────────────────────────────────────────
  console.log();
  console.log(c.bold('  Step 4/4 — Secrets (.env)'));
  console.log();

  const SECRETS = [
    { key: 'OPENAI_API_KEY',      label: 'OpenAI API key',       hint: 'sk-...',  used: 'claude-code-tts TTS relay' },
    { key: 'TELEGRAM_BOT_TOKEN',  label: 'Telegram bot token',   hint: '12345:AAH...',  used: 'telegram-approve hook' },
    { key: 'TELEGRAM_CHAT_ID',    label: 'Telegram chat ID',     hint: '8864848...',   used: 'telegram-approve hook' },
  ];

  // Parse existing .env
  const existingEnv = {};
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)\s*=\s*"?([^"]*)"?/);
      if (m) existingEnv[m[1]] = m[2];
    }
  }

  const missing = SECRETS.filter(s => !existingEnv[s.key]);

  if (!missing.length) {
    console.log(`  ${c.green('✓')} ~/.claude/.env exists with all required secrets.`);
  } else {
    console.log(`  The following secrets are missing from ${c.bold('~/.claude/.env')}:\n`);
    for (const s of missing) {
      console.log(`    ${c.cyan(s.key)} — ${s.used}`);
    }
    console.log();

    const setupEnv = await confirm(iface, '  Enter secrets now?');
    if (setupEnv) {
      const newValues = {};
      for (const s of missing) {
        const val = await ask(iface, `  ${c.bold(s.label)} ${c.dim(`(${s.hint})`)}:\n  > `);
        if (val) newValues[s.key] = val;
      }

      if (Object.keys(newValues).length) {
        const lines = [
          '# ~/.claude/.env — central secrets store',
          '# chmod 600 this file. Do NOT commit.',
          '',
          ...Object.entries({ ...existingEnv, ...newValues }).map(
            ([k, v]) => `${k}="${v}"`
          ),
          '',
        ];
        fs.writeFileSync(ENV_FILE, lines.join('\n'), 'utf8');
        fs.chmodSync(ENV_FILE, 0o600);
        console.log(`  ${c.green('✓')} Secrets written to ~/.claude/.env (chmod 600).`);
      }
    } else {
      console.log(c.dim(`  Skipped. Add secrets manually to ~/.claude/.env before using hooks.`));
    }
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log();
  console.log(c.bold(c.green('  ✓ Installation complete.')));
  console.log();
  console.log(c.dim('  Restart Claude Code (or reload settings) to activate hooks.'));
  console.log();

  iface.close();
}

main().catch(err => {
  console.error(c.red('\n  Error: ' + err.message));
  process.exit(1);
});
