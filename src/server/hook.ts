import { readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { type Core, type DirectoryView, type Hook, type HookEdit } from "../core/index.ts";
import { diffLines, formatter, plural, withContext } from "../view/index.ts";
import { findingLine, findings } from "./commands.ts";

// The session check: an opt-in SessionStart hook that runs `ccdesk hook --run`, and the commands
// that add it to settings and take it out again. The hook answers with a `systemMessage` or with
// nothing, never with plain stdout: Claude Code adds a SessionStart hook's plain stdout to Claude's
// context, while a `systemMessage` is shown to the user only. It makes no model call.

/** The version this ccdesk was published as, which the hook it installs pins. */
export const VERSION: string = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
).version;

/**
 * The hook's command. The version is pinned so npx runs its cached copy rather than asking the
 * registry for the latest one at every session start; installing again moves the pin.
 */
export function hookCommand(version: string): string {
  return `npx -y ccdesk@${version} hook --run`;
}

/** Whether a hook command is a session check that some version of ccdesk installed. */
const OURS = /(^|\s)ccdesk(@\S+)?\s+hook\s+--run(\s|$)/;

/** The most findings the message lists before it says how many more there are. */
const SHOWN = 5;

/**
 * `ccdesk hook --run`: what the hook prints for the session whose SessionStart input is `input`.
 * Empty when nothing is wrong. Values in managed settings are left out, since only your
 * organisation can change them.
 */
export async function sessionCheck(core: Core, input: string): Promise<string> {
  const message = (text: string) => JSON.stringify({ systemMessage: text });
  try {
    const cwd = (JSON.parse(input || "{}") as { cwd?: unknown }).cwd;
    const dir = await realpath(typeof cwd === "string" ? cwd : process.cwd());
    const view = await core.scanDirectory(dir);
    const managed = new Set(view.settings.filter((l) => l.scope === "managed").map((l) => l.path));
    const found = findings(view).filter((f) => f.setting === undefined || !managed.has(f.path));
    if (found.length === 0) return "";
    const { relativeTo } = formatter(core.env.home);
    const root = view.gitRoot ?? view.path;
    const lines = found.slice(0, SHOWN).map((f) => `  ${findingLine(relativeTo(f.path, root), f)}`);
    if (found.length > SHOWN) lines.push(`  and ${found.length - SHOWN} more`);
    return message(
      [
        `ccdesk found ${plural(found.length, "problem")} in what this session loads:`,
        ...lines,
        "Run npx ccdesk here to see and fix them.",
      ].join("\n")
    );
  } catch (error) {
    return message(`ccdesk could not check this session: ${(error as Error).message}`);
  }
}

/** Asks whether to go ahead with the change `review` shows. */
export type Confirm = (review: string, question: string) => Promise<boolean>;

export interface HookChange {
  dir: string;
  /** `project` puts the hook in the repository's .claude/settings.json, for everyone who uses it. */
  scope: "user" | "project";
  remove: boolean;
  version: string;
}

/** The words for each way of changing the hook. */
const WORDS = {
  install: {
    ask: "Add the session check to",
    did: "Added the session check to",
    none: "already in",
  },
  remove: {
    ask: "Take the session check out of",
    did: "Took the session check out of",
    none: "not in",
  },
};

/**
 * `ccdesk hook --install` and `--remove`: adds the session check to user or project settings, or
 * takes out every one there, each change shown as a diff and saved only once `confirm` says so. It
 * goes through the page's hook editing, so each save is backed up and Recent changes can undo it.
 */
export async function changeHook(
  core: Core,
  change: HookChange,
  confirm: Confirm
): Promise<{ output: string; exitCode: 0 | 1 | 2 }> {
  const { tilde } = formatter(core.env.home);
  const words = WORDS[change.remove ? "remove" : "install"];
  const done: string[] = [];
  try {
    // One edit at a time: removing a hook moves the place of the next one in the file.
    for (let edit = await nextEdit(core, change); edit; edit = await nextEdit(core, change)) {
      const name = tilde(edit.file);
      const preview = await core.previewHookEdit(edit);
      if (preview.errors.length > 0) throw new Error(preview.errors.join("; "));
      const review = diffText(name, preview.before ?? "", preview.after);
      if (!(await confirm(review, `${words.ask} ${name}?`)))
        return { output: [...done, "Nothing more changed."].join("\n"), exitCode: 1 };
      await core.saveHookEdit(edit, preview.revision);
      done.push(`${words.did} ${name}. Recent changes on the page can undo it.`);
      if (!change.remove) break;
    }
    if (done.length === 0) {
      const file = (await settingsFile(core, change)).path;
      return { output: `The session check is ${words.none} ${tilde(file)}.`, exitCode: 0 };
    }
  } catch (error) {
    return { output: `ccdesk: ${(error as Error).message}`, exitCode: 2 };
  }
  return { output: done.join("\n"), exitCode: 0 };
}

/** The settings file the change is for, as a scan of its directory sees it now. */
async function settingsFile(
  core: Core,
  change: HookChange
): Promise<{ view: DirectoryView; path: string }> {
  const view = await core.scanDirectory(await realpath(change.dir));
  const path = view.settings.find((l) => l.scope === change.scope && !l.legacy)?.path;
  if (path === undefined) throw new Error(`there are no ${change.scope} settings here`);
  return { view, path };
}

/**
 * The next edit the change needs, or null when it is done. Installing replaces a session check of
 * another version in place; removing takes out the first one left.
 */
async function nextEdit(core: Core, change: HookChange): Promise<HookEdit | null> {
  const { view, path } = await settingsFile(core, change);
  const command = hookCommand(change.version);
  const ours = view.inventory.hooks.filter(
    (h) =>
      h.sourcePath === path &&
      h.event === "SessionStart" &&
      h.type === "command" &&
      OURS.test(h.command)
  );
  const current = (h: Hook) => h.command === command && h.matcher === "startup";
  if (!change.remove && ours.some(current)) return null;
  const old = change.remove ? ours[0] : ours.find((h) => !current(h));
  if (change.remove && !old) return null;
  return {
    dir: view.path,
    file: path,
    ...(old ? { remove: { event: old.event, at: old.at, definition: old.definition } } : {}),
    ...(change.remove
      ? {}
      : {
          add: {
            event: "SessionStart",
            matcher: "startup",
            definition: { type: "command", command, timeout: 30 },
          },
        }),
  };
}

const MARK = { add: "+", remove: "-", same: " " };

/** The change to `name` as a diff with three lines of context around each change. */
function diffText(name: string, before: string, after: string): string {
  const rows = withContext(diffLines(before, after)).map((r) =>
    r.kind === "skip" ? `  … ${plural(r.count, "line")} unchanged` : `${MARK[r.kind]} ${r.text}`
  );
  return [`${name}:`, ...rows].join("\n");
}
