# Architecture

ccdesk is one npm package. `src/core` reads and writes Claude Code's configuration, `src/server` serves it over HTTP and holds the `ccdesk` bin, `src/view` turns what the core reads into the rows a front end lists, and a React page in `src/ui` talks to the server. `src/shared` holds the types they all use. `src/core` imports nothing from `src/server`, and `src/shared`, `src/view` and `src/ui` import neither of them nor any Node module; the overrides in `biome.json` fail the lint when one does. `src/core/index.ts` is the package's import entry point (`import { scanDirectory } from "ccdesk"`), and `src/view/index.ts` is `ccdesk/view`. The [contributing page](https://ayagmar.github.io/ccdesk/contributing/) covers the development loop, the generated data and releases; this file covers how the code fits together.

## Module map

| Path | What it does |
| --- | --- |
| `src/server/cli.ts` | The `ccdesk` bin: parses the arguments, builds a `ScanEnv` and a core, then runs a subcommand or starts the server and opens the browser. It loads `start.ts`, and so the server, only to serve the page. |
| `src/server/args.ts` | `parse(argv)`: the arguments as a command (`serve`, `scan`, `explain` or `help`), or a `UsageError` with the message to print. Reads no files. |
| `src/server/commands.ts` | What `ccdesk scan --json` and `ccdesk explain` print. Imports only the core and `src/view`. |
| `src/server/start.ts` | `startServer(options)`: serves a core on 127.0.0.1 and resolves `{ url, close }`. |
| `src/server/server.ts` | The `/api/*` routes, each a call on the core it is given; the token, Host and Origin checks, security headers, and the built UI. Turns errors into status codes. |
| `src/core/scan/` | Reads. `index.ts` has `scanOverview` and `scanDirectory`; the other files each read one part (settings, instructions, memory, MCP, plugins, permissions, tools, context, usage, compare, path-test). `env.ts` defines `ScanEnv`, `files.ts` reads files (never the credentials file) and puts one that is there but cannot be read or parsed into the scan's problems, `data.ts` has `isRecord` and frontmatter parsing, and `git.ts` asks git for roots, worktrees and what is tracked. |
| `src/core/settings-edit.ts` | Settings, permission and hook edits, all in settings files. |
| `src/core/agent-edit.ts`, `mcp-edit.ts`, `mutations.ts` | Subagent files, MCP servers, and auto memory. |
| `src/core/parse-edit.ts` | Turns untrusted input (a JSON body) into a typed edit, or throws `InvalidEditError`. It checks the body against its schema in `src/shared/requests.ts`, then the rules a schema cannot state, such as a known hook event. |
| `src/core/write.ts` | What every write shares: atomic writes through links, the backup folder and its manifest, the queue that runs changes one at a time, `RefusedError` and `StaleError`. |
| `src/core/backups.ts` | Lists, previews and restores backups (Recent changes and Undo). |
| `src/core/secrets.ts` | What the page may see: `redactSecrets`, `shownText`, `shown`, `hasHiddenValues`. |
| `src/core/watch.ts` | `Watcher`: scans a directory, watches the files the scan read, answers the page's long poll, and calls subscribers when one of them changes. |
| `src/core/schema.ts` | `schemaErrors`: what a TypeBox validator found wrong, each led by where, such as `sandbox.network must NOT have additional properties`. Settings edits and MCP servers are checked with it. |
| `src/core/reference.ts` | The settings schema, settings catalog and hook events, served by `/api/reference`. |
| `src/core/open.ts` | Opens a file in the editor the `ScanEnv`'s environment names, or a URL in the default browser, the way its platform starts one. |
| `src/core/core.ts` | `createCore(env, options)`: every read and change with `env` bound, its own change queue and usage cache, and the editor and `claude` it starts. |
| `src/core/index.ts` | The import entry point; re-exports `createCore` and the free functions. |
| `src/view/sections/` | Each section's rows, columns and sort keys, filter text, labels, facets and empty text, as a `ViewSection`; `index.ts` lists them in page order and has `buildRows`. `rows`, `label`, `heading` and `facet.order` take a `ViewContext`: a formatter for the home folder and the settings reference. |
| `src/view/` | What the page shows without React: `formatter(home)` and the other text helpers, the scope lines, the diff, the usage sentences, and for settings `valuesIn` and the setting editor's form: `fieldKind` picks each value's control, `editKind` falls back to JSON when that control cannot show the file's value exactly, `toDraft` and `fromDraft` convert between a value and what the form holds, `followFile` decides whether a form follows a file that changed under it, `asJson` and `asForm` switch a form to JSON and back, `expects` says what shape a JSON value takes, `parseJson` reads typed JSON, and `replacedBuiltIns` names the `autoMode` lists in a value that drop Claude Code's built-in rules. `index.ts` is `ccdesk/view`. |
| `src/shared/` | Types (`types.ts`), scope lists, the request schemas (`requests.ts`), and the JSON generated from Claude Code's SDK and docs, with SchemaStore's schema for documented keys the SDK lacks. No Node or DOM imports. Each edit type is read from its TypeBox schema and re-exported by `types.ts`, so the page imports only types and TypeBox stays out of its bundle; `biome.json` fails the lint if `src/ui` imports `typebox` or `requests.ts`. |
| `src/ui/` | The page. Imports `src/shared` and `src/view`, and calls the server through `api.ts`. `sections/` adds each table's cells, heading notes and inspector to the view's section. |

## From disk to the page

```
ScanEnv → scanDirectory(env, dir, profile) → DirectoryView → /api/directory → buildRows (src/view) → rows → cells (src/ui)
```

`ScanEnv` holds every location ccdesk reads: home, the Claude folder, `.claude.json`, the managed folder, on macOS the configuration profiles that outrank it, the platform, and `processEnv`, the environment ccdesk finds an editor and `claude` in and passes to them. `scanEnvFromProcess` builds it from the real machine; tests build one around a throwaway folder with `makeFixture()`, whose `processEnv` is empty. Every read and write takes it as its first argument, so nothing in the core reads `homedir()`, `process.platform` or `process.env` itself. Biome's `noProcessEnv` rule fails the lint on any other `process.env` in `src/core`, `src/view`, `src/shared` and `src/ui`; `scanEnvFromProcess` carries a `biome-ignore` saying why.

`createCore(env, { runClaude?, openFile? })` binds `env` to every read and change and returns them as methods, such as `core.scanDirectory(dir)` and `core.saveSettingsEdit(edit, revision)`. The server takes a core; tests pass `runClaude` and `openFile` fakes so nothing is started.

`scanDirectory` returns one `DirectoryView`: the instruction files, settings layers and effective settings, permissions, built-in tools, memory, hooks, MCP servers, extensions, context, trust, sharing and problems for one directory and session profile. A problem is a file the scan found but could not read or parse, such as `~/.claude.json`, a settings or MCP file, a plugin manifest or a memory file; a missing file is not one. A plugin's manifest is read once per scan, when the plugin is loaded, and the managed and effective settings are passed down to the readers that need them rather than read again. The page fetches it through `Watcher.scan`, which also records the files the scan read so a change to any of them wakes `/api/watch`. On the page, `useConfig` holds the view and `buildRows` from `src/view` turns it into rows, one list per section in page order. `src/ui/sections/index.ts` joins each view section to the page's cells and inspector by section id. Outside the page, `buildRows(view, { format: formatter(env.home), reference: REFERENCE })` gives the same rows.

Usage counts arrive separately: the page posts the rules in effect to `/api/usage` after each scan, and the core's `readUsage` counts calls in the transcripts. The settings schema and catalog are fetched once from `/api/reference`; no directory is shown before they arrive.

## Secrets

Values under `env` and `headers`, keys in URLs, and secret-looking arguments of MCP servers are replaced with `•••` by `redactSecrets` in `secrets.ts`. MCP policy entries are hidden the same way (`serverCommand` arguments, `serverUrl` credentials); the policy check matches against each layer's file data, which `unredactedData` in `scan/settings.ts` keeps outside the view. The scan applies it before a value goes into a `DirectoryView`, and every preview and restore preview shows files through `shownText` or `shown`, so a hidden value never reaches the browser, diffs included. Files named like the credentials file, or linked to it, are never read (`isSecretPath`, `isCredentials`), and a core's `openFile` refuses to open them, whatever opener it was given.

ccdesk never writes back a value the page saw as `•••`. Settings, hook and agent edits refuse when the value they change holds a hidden value, or when the new value would be hidden (`settings-edit.ts`, `agent-edit.ts`). Restoring a settings or MCP file is refused when its hidden values changed since the backup, unless the file no longer parses. A new MCP server may hold the env values and headers you type for it.

## Review, then save

Every edit runs twice: once to show it, once to make it.

1. `preview*(env, edit)` plans the edit from the file on disk and returns the diff and a `revision`, a fingerprint of what it read. For a settings, permission, hook, project MCP or agent edit, `reviewRevision` in `write.ts` also binds the path and the file it leads to, so a save that would land in another file, such as a local settings file that moved to a new repository's root, needs a new review. A memory change binds two files (the memory and `MEMORY.md`) into one revision.
2. A core's `save*(edit, revision)` plans the same edit again and writes only if the revision still matches. It returns a `Change`: `id` (its backup folder), `target`, the file's `revision` after the change, and `created` when the file did not exist.
3. Undo is `core.restoreBackup(change.id, change.revision)`. Recent changes uses `listBackups`, then `previewRestore(env, id)` for the diff and its revision, then `restoreBackup` with that revision.

Each kind of edit plans its change as a `Planned` (the preview and a `save` that writes it), and its save goes through `saveReviewed` in `write.ts`: it plans again, refuses on errors or a changed revision, and writes, all in one turn of the change queue. On the page, every editor runs both steps through the `useReviewedChange` hook.

Errors a front end should handle:

- `InvalidEditError`: the input is not a well-formed edit (unknown scope, missing field). The server answers 400. Other malformed requests, such as a usage count with an unknown rule list or a relative path, are answered 400 by the server itself.
- `RefusedError`: ccdesk will not make the change. That covers a file changed since the preview, schema errors, hidden values, managed settings, credentials and `~/.claude.json`, so the message says which. `openFile` also throws it when no editor starts, naming `CCDESK_EDITOR`. The server answers 409.
- `StaleError`, a subclass of `RefusedError`: the file changed while ccdesk was writing it, after the revision check. Nothing was written and no backup is kept. A front end treats it like any `RefusedError`: review again.

Changes that cannot be undone from ccdesk:

- User and local MCP servers. They live in `~/.claude.json`, which ccdesk never writes, so `saveMcpEdit` runs `claude mcp` and returns `{ target }` instead of a `Change`. Recent changes lists the change with the commands that reverse it.
- A change that created its file and stopped halfway, or whose file changed after ccdesk created it: ccdesk will not remove a file it cannot tell it wrote.
- Putting a deleted memory back. Delete it again instead.

## Backups

Each change gets a folder in `<Claude folder>/backups/ccdesk/<id>/`, readable only by you. The id is the time, a random suffix and the kind, such as `2026-10-12T19-15-02-123Z-a1b2c3-settings`, so ids sort by time.

- `before`: the file before the change. Absent when the change created the file.
- `ccdesk-backup.json`: the manifest, checked against `BackupManifestSchema` in `write.ts` when read; a folder whose manifest does not match is not listed. `kind` (one of `BACKUP_KINDS` in `src/shared/types.ts`), `target`, `createdAt`, the `before` revision (`missing` for a created file) and the `after` revision. `after` is `pending` while the change runs and `partial` if it failed after writing something. A deleted memory also records the `MEMORY.md` lines removed with it.
- `after`, for `claude mcp` changes only: the affected servers after the change, values hidden. Their manifest holds `undoCommands`.

The manifest and `before` are written before the change, so an interrupted change can still be restored. A change that fails without changing the file removes its folder.

## Shared state

Each core has its own:

- change queue (`changeQueue()` in `write.ts`), which runs its changes one at a time so two saves cannot both pass the revision check. Two cores on the same Claude folder do not wait for each other, so make one per folder.
- usage counter (`usageCounter()` in `scan/usage.ts`): the transcript cache, its queue, and the requests waiting on a count.

Saves, restores, memory changes and usage counts are exported only as a core's methods, so every change runs on a core's queue. Reads and previews are also exported as free functions that take the `ScanEnv` first; they keep no state.

Still in module scope, and shared by every core:

- The compiled TypeBox validators in `settings-edit.ts`, `scan/mcp.ts`, `parse-edit.ts`, `backups.ts` and `server.ts`. They come from bundled schemas and never change, so sharing them changes no result. `schemaErrors` lifts TypeBox's process-wide limit of eight errors while it lists them and puts it back after.
- In the page: `format.ts` keeps the formatter for the home folder the overview names, and `reference.ts` keeps the data from `/api/reference`. `src/view` keeps neither; its callers pass them in a `ViewContext`.

`Watcher` is per instance; the server makes one from its core's `env`.

## Docs citations

Some behaviour is copied from prose in Claude Code's docs, such as how rules match commands. The code cites the section in a `docs: page#anchor` comment, and `pnpm docs:fingerprints` hashes each cited section so the daily data workflow can list the ones whose text changed.

## Further reading

- [docs/split-plan.md](docs/split-plan.md): splitting the core from the web server so a CLI and a TUI can use it.
- [docs/feature-ideas.md](docs/feature-ideas.md): features the code is close to supporting.
