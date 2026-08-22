/**
 * Enforce Agent Note lifecycle/class paths and dated filenames. Structural rules
 * are shared with `agent-note-tree.ts`; the closed classification rules live
 * in `.agent/notes/README.md`.
 *
 * Wire into your package.json as:
 *   "verify-agent-note-classification": "tsx scripts/verify-agent-note-classification.ts"
 *
 * Optional: `AGENT_NOTE_LEGACY_ROOTS` (comma-separated repo-relative paths) lists
 * former homes that must stay empty so new notes cannot silently escape the tree;
 * the originating project forbade `docs/rfc` and `docs/rfcs`.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { agentNoteRelDir, walkAgentNoteTree } from './agent-note-tree.ts'

const { notes, errors } = walkAgentNoteTree()

// Keep the former homes unavailable so new notes cannot silently escape this tree.
const legacyRoots = (process.env.AGENT_NOTE_LEGACY_ROOTS ?? '').split(',').map(root => root.trim()).filter(Boolean)
for (const legacyRoot of legacyRoots) {
  if (existsSync(resolve(import.meta.dirname, '..', legacyRoot))) {
    errors.push(`legacy-path: ${legacyRoot}/ is forbidden — put Agent Notes under ${agentNoteRelDir}/`)
  }
}

if (errors.length === 0) {
  console.log(`verify-agent-note-classification: ${notes.length} Agent Note(s) checked, structure consistent.`)
  process.exit(0)
}

console.error('verify-agent-note-classification: violations found:')
for (const e of errors) console.error(`  ${e}`)
process.exit(1)
