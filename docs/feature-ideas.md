# Feature ideas

Ideas, not commitments: each one is something the code is already close to supporting. Sizes are rough. S is a day or less, M a few days, L a week or more. Most of the CLI ideas assume steps 1 and 2 of the [split plan](split-plan.md).

## On the command line

**`ccdesk scan [dir] --json`** (S). Prints the `DirectoryView` that `scanDirectory` returns. Scripts and other tools could then ask what Claude Code loads in a directory without starting a browser. The view is already redacted, so the output carries no hidden values.

**`ccdesk explain <file>`** (S). Prints what Claude Code adds to context once Claude reads or edits that file: the rules whose `paths` match, the skills, and the nested `CLAUDE.md` files. This is `testPath`, which the page's path test already uses, with a text format.

**`ccdesk check [dir]`** (S). Exits non-zero when the scan reports problems: files ccdesk could not read or parse, and above all the ones marked `blocksStart`, which stop Claude Code from starting. A repository could run it in CI to catch a broken `.claude/settings.json` or `.mcp.json` before anyone pulls it.

**`ccdesk compare <a> <b>`** (S). The page's compare view as text: each setting's value in two directories and the files it comes from, from `compareSettings`.

**`ccdesk changes` and `ccdesk undo <id>`** (M). Lists Recent changes and restores one, through `listBackups`, `previewRestore` and `restoreBackup`. Restoring needs a review step in the terminal: print the diff, ask, then pass the reviewed revision, as the page does.

**`ccdesk rules --suggest [dir]`** (M). Lists the allow rules that would cover calls you approved by hand, with how many calls each covers. The counting is `readUsage`; the suggestions are built by `suggestedRules`, which lives in the page today and moves with step 4 of the split plan.

## On the page

**Push changes instead of long polling** (M). The page now holds a request open on `/api/watch` and asks again after each answer. With `Watcher.subscribe` (split plan step 5), the server could push a message over server-sent events when a watched file changes. A TUI would subscribe the same way.

**Watch `~/.claude.json`** (M). Trust decisions and user MCP servers show up only when you return to the tab, because Claude Code rewrites the file constantly. Watching it and rescanning only when the parts ccdesk shows change would make those updates live too.

## In a terminal UI

**`ccdesk tui`** (L). The directory page in a terminal, built on the core and on `src/view` (split plan step 4) for the rows, labels and sort order, with the same review-then-save steps as the page. It depends on every step of the split plan except the CLI.
