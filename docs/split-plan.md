# Splitting the core from the web server

ccdesk's reading and writing code should be usable without the HTTP server, so that a command-line tool and a terminal UI can sit beside the web page and share it. This plan lists the steps in order. Each step keeps `pnpm check` green and ships on its own. [ARCHITECTURE.md](../ARCHITECTURE.md) describes the code as it is now.

## Decision: one package with subpath exports first

The core stays a folder in this package, reached through `exports` subpaths in `package.json` (`ccdesk` today; later `ccdesk/core` and `ccdesk/view`). It becomes a separate workspace package only when a CLI or TUI needs to be released on a different schedule from the web app. Until then a split would mean changing the test glob, both tsconfigs, Biome's file list, the release workflow, release-it's config and the data workflow's `git add` list together, for no user-visible gain.

## Done

These landed after v0.2.2.

- **The core is importable.** `src/core/index.ts` re-exports the scan, the watcher, every preview and save, backups, the errors and the shared types. The build emits declarations, `package.json` maps `"."` to `dist/core` with its types, and CI imports the packed package. Test: `test/core.test.ts`.
- **Edit input is checked in the core.** The parsers that were in `server.ts` are `parseSettingsEdit`, `parsePermissionEdit`, `parseHookEdit`, `parseAgentEdit` and `parseMcpEdit` in `src/server/parse-edit.ts`, throwing `InvalidEditError` (400). Planning a hook edit already refused unknown events. Test: `test/core-parse.test.ts`.
- **A core-level round trip.** `test/core-edits.test.ts` saves and undoes a permission edit through the core. Settings, agent, project MCP and memory round trips stay in `test/server.test.ts`, whose routes pass edits straight to the same functions.
- **Generated data comes from the server.** The settings schema, catalog and hook events are exported from the core as `REFERENCE` and served by `/api/reference`, so the page no longer bundles them (913 kB to 496 kB).
- **The core has its seams (step 1).** `createCore(env, { runClaude?, openFile? })` in `src/core/core.ts` returns every read and change with `env` bound, and `createCcdeskServer` takes a core instead of `env`, `openFile` and `runClaude`. Each core makes its own change queue (`changeQueue()` in `write.ts`) and usage counter (`usageCounter()` in `scan/usage.ts`). `ScanEnv` gained `processEnv`, the environment ccdesk finds an editor and `claude` in; `openInEditor`, its `launch`, and `claudeRunner(env)` (which replaces `runClaude`'s body) take the platform and environment from it, and `claudeProgram` lost its `process` defaults. The free save functions take an optional queue as their last argument and `openInEditor` an optional host, defaulting to the process-wide queue and `process`; `readUsage` and `runClaude` use a process-wide counter and `process`. Existing calls still work; remove these defaults and wrappers one release later. The compiled schema validators in `settings-edit.ts` stay in module scope: they come from the bundled schema and never differ between cores, and Ajv caches compiled schemas itself. Tests: `test/core-instances.test.ts` (a save on one core does not wait for another core's; one core's usage count does not evict another's cache; a `win32` env opens a `.cmd` editor through `cmd.exe` and runs the `claude.exe` behind npm's `claude.cmd`, with the env's environment).

## Remaining steps

### 2. Split the CLI

Scope: `cli.ts` today parses flags, builds a core, starts the server and opens the browser in one `main()` that runs on import, with its own browser launcher, `openBrowser`. Split it into a pure `parse(argv)`, a `startServer(options)` that takes a core and returns `{ url, close }`, and a short bin. Open the browser through `open.ts`'s spawn plan, with the platform and environment from the core's `env`.

Done when: `parse` has unit tests for the flags and errors, `startServer` runs in a test with `uiDir: null`, and CI's pack smoke test still passes.

### 3. Move the files

Scope: `src/server/scan`, `write.ts`, the edit modules, `parse-edit.ts`, `backups.ts`, `watch.ts`, `secrets.ts`, `schema.ts`, `reference.ts` and `open.ts` (which `createCore` uses) move to `src/core/`; `src/server` keeps `server.ts` and the CLI. On the way, split `scan/files.ts` (490 lines) into file reading, git, and redaction, merging `secrets.ts` into the last. Imports change; logic does not.

Done when: `src/core` imports nothing from `src/server`, the diff outside import lines is empty, and `tsconfig.build.json` lists the new folders.

### 4. Pull the view logic out of React

Scope: each `src/ui/sections/*.tsx` mixes plain data functions (`rows`, `columns` sort keys, `text`, `label`, `heading`, `dimmed`, `facet`, `empty`) with JSX (`cells`, `Head`, `Details`). Move the data half to `src/view/` with no React import, along with `valueHere` (catalog), `outcome` and `callsOf` (tools), `suggestedRules` (`usage.ts`), the scope vocabulary in `lines.ts`, `fieldKind`, `valuesIn` and the diff in `diff.ts`. Replace `format.ts`'s `setHome` with a `formatter(home)`. Move `test/catalog.test.ts` and `test/diff.test.ts` with their code. Export it as `ccdesk/view`.

Done when: `src/view` has no `react` import, the page renders the same rows, and a Node test builds every section's rows from a fixture's `DirectoryView`.

### 5. Push changes instead of long polling

Scope: add `Watcher.subscribe(dir, onChange)` returning an unsubscribe function, built on the existing per-directory waiters in `watch.ts`. Keep `wait()` for `/api/watch`.

Done when: a test sees `onChange` called once after a watched file changes, and not after unsubscribing.

### 6. Build a CLI on the core

Scope: subcommands of the existing `ccdesk` bin, such as `ccdesk scan --json` (see [feature ideas](feature-ideas.md)), importing only `ccdesk` (the core), never `src/server/server.ts`.

Done when: the subcommands work from the packed package, and their output is tested against a fixture. Decide on workspace packages only after this, and only if the release schedules need to differ.

Steps 2, 3 and 5 touch no page code. Step 4 is needed only for a TUI; the CLI in step 6 needs step 2.
