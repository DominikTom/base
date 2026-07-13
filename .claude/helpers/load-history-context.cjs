#!/usr/bin/env node
// SessionStart hook: load the newest file from docs/audits/ and docs/decisions/
// into Claude Code's context so every new agent in the session starts with
// historical knowledge.

const fs = require('fs');
const path = require('path');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const DIRS = ['docs/audits', 'docs/decisions'];
const MAX_PER_FILE = 8000;

const sections = [];

for (const dir of DIRS) {
  const abs = path.join(ROOT, dir);
  let entries;
  try {
    entries = fs.readdirSync(abs);
  } catch {
    continue;
  }
  const files = entries
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const full = path.join(abs, f);
      try {
        return { name: f, mtime: fs.statSync(full).mtimeMs, full };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) continue;
  const latest = files[0];
  let content;
  try {
    content = fs.readFileSync(latest.full, 'utf8');
  } catch {
    continue;
  }
  const truncated = content.length > MAX_PER_FILE
    ? content.slice(0, MAX_PER_FILE) + '\n\n... [truncated to ' + MAX_PER_FILE + ' chars]'
    : content;
  sections.push('# ' + dir + '/' + latest.name + '\n\n' + truncated);
}

if (sections.length === 0) {
  process.exit(0);
}

const additionalContext =
  'Historical context for this repo (latest entry per directory):\n\n' +
  sections.join('\n\n---\n\n');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext,
  },
}));
