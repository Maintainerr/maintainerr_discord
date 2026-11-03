# Maintainerr Discord Bot Rules

The bot's phase plan and audit log are maintainer-held and deliberately not
published here. Everything a contributor needs is in this file.

The shared conventions come from the Maintainerr app's
[agent index](https://github.com/Maintainerr/Maintainerr/blob/main/AGENTS.md),
[implementation rules](https://github.com/Maintainerr/Maintainerr/blob/main/.github/instructions/implementation.instructions.md),
[project notes](https://github.com/Maintainerr/Maintainerr/blob/main/.github/instructions/project-notes.instructions.md),
and [contribution guide](https://github.com/Maintainerr/Maintainerr/blob/main/CONTRIBUTING.md).
Reviewed against app `main` at `3dbd5463a82beb4cd970a41c3afd042af4fccfd8` on
2026-11-02. The applicable rules are recorded below for this bot's stack.

## Implementation

- Use Node 26, ESM JavaScript, `node:sqlite`, and the existing capability layout.
- Ask before adding dependencies, changing the schema, or widening the agreed
  scope. Reuse existing helpers and locks, and keep fixes small and complete.
- Reproduce a defect before changing behavior. Trace its callers, persisted
  state, and recovery paths. Report unrelated findings separately.
- Prefer `startsWith`, `endsWith`, `includes`, `slice`, `replaceAll`, and character
  inspection for simple string operations. Reserve regex for parsing that would
  be materially more complex by hand, such as multiline or escaped input.
- Keep comments terse and explain non-obvious reasons. Remove unused identifiers
  instead of prefixing them with underscores.
- Use debug logging by default. Warnings identify something a human must act on;
  routine diagnostics and caught-error detail belong at debug level.
- Preserve the original formatter and rule definitions byte for byte, and keep
  their existing tests to import-path changes only.

## Text

- Use plain ASCII hyphens throughout committed artifacts, including log messages,
  fixtures, documentation, commit messages, and PR descriptions.
- Write "Seerr" in user-facing text and use each product's official capitalization.
- Use invented media titles in tests, fixtures, and documentation.
- Keep UI text concise. Use title case for headings, buttons, and form labels.
  Form labels and validation tips have no trailing punctuation; full-sentence
  messages end with punctuation. Keep displayed text separate from stable IDs.

## Validation and Delivery

- Run commands from the repository root. Tests use `node --test` via `yarn test`.
- Test observable behavior and approved safety contracts. Extend existing tables
  before adding scaffolding. A guard test must fail when its guard is removed.
  Avoid exporting a helper only to test it.
- Use fake clocks and stubbed transports in tests. Keep temporary databases under
  `os.tmpdir()` and remove them after the check.
- Exercise success, failure, boundary, concurrency, and restart paths affected by
  the change. Count actual writes for idempotency, and inspect recovered state.
- Run focused checks during development and the full `yarn test` suite for final
  validation. Run `yarn format` in write mode before committing, then review the
  diff for unrelated changes.
- Record changes, evidence, and limitations in [AUDIT.log](AUDIT.log). Preserve
  unrelated working-tree and staged changes.
- Use Conventional Commits and focused PRs. Keep PR descriptions brief and
  explain the behavior and reason for the change.
- Live Discord and GitHub acceptance belongs to the maintainer until the test
  guild, scratch repository, and GitHub App exist. Keep integration checks local
  and offline in the meantime, and report that limitation explicitly.
