import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join, posix, win32 } from "node:path";
import { type ScanEnv } from "./scan/env.ts";
import { RefusedError } from "./write.ts";

/** Editors that need a terminal; started from a background server they would have none. */
const TERMINAL_EDITORS = new Set([
  "vi",
  "vim",
  "nvim",
  "nano",
  "emacs",
  "hx",
  "helix",
  "micro",
  "kak",
  "ed",
]);

/** Graphical editors ccdesk looks for when VISUAL and EDITOR name none. */
const GUI_EDITORS = [
  "code",
  "cursor",
  "zed",
  "codium",
  "subl",
  "kate",
  "gnome-text-editor",
  "gedit",
];

/** An editor still running this long after it started is taken to have opened the file. */
const START_MS = 1500;

type Command = [string, string[]];

/** The machine an editor is looked for and started on. */
type Host = Pick<ScanEnv, "platform" | "processEnv">;

/** Whether `name` is an executable on PATH. */
function onPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, name: string): boolean {
  const extensions =
    platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  for (const dir of (env.PATH ?? "").split(platform === "win32" ? ";" : delimiter)) {
    for (const ext of extensions) {
      try {
        accessSync(join(dir, name + ext), platform === "win32" ? constants.F_OK : constants.X_OK);
        return true;
      } catch {
        // Not in this folder.
      }
    }
  }
  return false;
}

/**
 * The commands to try, in order: `CCDESK_EDITOR` alone when set; else `VISUAL` or `EDITOR` when
 * they name a graphical editor, then graphical editors found on PATH, then the system's opener.
 * The system opener comes last because on Linux it often picks a terminal editor or nothing for
 * JSON and Markdown.
 */
export function editorCommands(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  found: (name: string) => boolean = (name) => onPath(env, platform, name)
): Command[] {
  const split = (value: string): Command => {
    const [command = "", ...args] = words(value);
    // A wait flag would keep the editor tied to this server's process.
    return [command, args.filter((a) => a !== "-w" && a !== "--wait")];
  };
  const name = (command: string) =>
    (platform === "win32" ? win32 : posix)
      .basename(command)
      .replace(/\.(exe|cmd|bat)$/i, "")
      .toLowerCase();
  if (env.CCDESK_EDITOR) return [split(env.CCDESK_EDITOR)];
  const out: Command[] = [];
  for (const value of [env.VISUAL, env.EDITOR]) {
    if (!value) continue;
    const command = split(value);
    if (!TERMINAL_EDITORS.has(name(command[0]))) out.push(command);
  }
  for (const editor of GUI_EDITORS) if (found(editor)) out.push([editor, []]);
  out.push(
    platform === "darwin"
      ? ["open", []]
      : platform === "win32"
        ? ["explorer", []]
        : ["xdg-open", []]
  );
  return out.filter((c, i) => out.findIndex((o) => o[0] === c[0]) === i);
}

/** Splits an editor setting into words, keeping quoted parts such as "C:\Program Files\…" whole. */
function words(value: string): string[] {
  return [...value.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

/**
 * How to start `command` on `path`. On Windows a .cmd or .bat file (VS Code's `code`) or a bare
 * name that may resolve to one cannot be started directly, so it goes through cmd.exe, quoted.
 */
export function spawnPlan(
  command: string,
  args: string[],
  path: string,
  platform: NodeJS.Platform
): { file: string; args: string[]; verbatim: boolean } {
  const direct = { file: command, args: [...args, path], verbatim: false };
  if (platform !== "win32" || /\.(exe|com)$/i.test(command) || command === "explorer")
    return direct;
  // Inside cmd.exe quotes, " cannot be escaped and %NAME% still expands.
  if ([command, ...args, path].some((part) => /["%]/.test(part)))
    throw new Error("This path cannot be passed safely to a .cmd editor; open it yourself.");
  const line = [command, ...args, path].map((part) => `"${part}"`).join(" ");
  return { file: "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
}

/** Starts one command; resolves null once it is running or exited cleanly, else why it failed. */
function launch([command, args]: Command, path: string, host: Host): Promise<string | null> {
  return new Promise((resolve) => {
    let plan: ReturnType<typeof spawnPlan>;
    try {
      plan = spawnPlan(command, args, path, host.platform);
    } catch (error) {
      return resolve((error as Error).message);
    }
    const child = spawn(plan.file, plan.args, {
      env: host.processEnv,
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: plan.verbatim,
    });
    const timer = setTimeout(() => {
      child.unref();
      resolve(null);
    }, START_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve(`${command}: ${error.message}`);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? null : `${command} exited with code ${code}`);
    });
  });
}

/**
 * Opens `url` in the default browser on `host`; resolves null once the opener started, else why it
 * failed. On Windows `start` is a cmd.exe builtin, so cmd.exe is the command.
 */
export function openBrowser(url: string, host: Host): Promise<string | null> {
  const command: Command =
    host.platform === "darwin"
      ? ["open", []]
      : host.platform === "win32"
        ? ["cmd.exe", ["/c", "start", ""]]
        : ["xdg-open", []];
  return launch(command, url, host);
}

/**
 * Opens a file or folder in the first editor that starts on `host`; resolves with the command
 * used. Without `host` it uses this process's platform and environment; use a core's instead.
 */
export async function openInEditor(
  path: string,
  // biome-ignore lint/style/noProcessEnv: the documented default of the free openInEditor; a core passes its own.
  host: Host = { platform: process.platform, processEnv: process.env }
): Promise<string> {
  const failures: string[] = [];
  for (const command of editorCommands(host.processEnv, host.platform)) {
    const failure = await launch(command, path, host);
    if (failure === null) return command[0];
    failures.push(failure);
  }
  throw new RefusedError(
    `Could not open it (${failures.join("; ")}). Set CCDESK_EDITOR to your editor.`
  );
}
