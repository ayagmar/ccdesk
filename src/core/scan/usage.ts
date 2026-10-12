import { open, realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { storeDirName } from "../../shared/memory.ts";
import {
  type Approval,
  type PermissionList,
  type ToolUsage,
  type Usage,
} from "../../shared/types.ts";
import { type ScanEnv } from "./env.ts";
import { isCredentials, isDir, isRecord, isWithin, listDir, wildcard } from "./files.ts";
import { worktrees } from "./git.ts";
import { namesTool, parseRule } from "./tools.ts";

/** One tool call, reduced to what counting and rule matching need. Never sent to the browser. */
interface Call {
  tool: string;
  at: string;
  /** Bash and Monitor: every command a Bash rule might see in the call (see everyCommandIn). */
  commands?: string[];
  /** WebFetch: the host, for matching domain rules. */
  host?: string;
  /** The allow rule that would have covered the call (see ruleFor). */
  rule: string | null;
  /** Set when Claude Code asked you: true when you allowed the call. */
  byYou?: boolean;
}

interface Transcript {
  size: number;
  mtimeMs: number;
  /**
   * Bytes read so far. Claude Code only appends to a transcript, so a later read starts here; one
   * that shrank is read again from the start, and one rewritten in place is not noticed.
   */
  offset: number;
  calls: Call[];
  byId: Map<string, Call>;
  /** The folder the session started in: the first one its transcript records. */
  startCwd?: string;
}

/** A rule in effect here, as the scan found it. */
export interface RuleInEffect {
  list: PermissionList;
  rule: string;
}

/**
 * Transcripts already counted, by path, so reopening a directory reads only what was added. Kept
 * in memory only, least recently counted first; once they hold more than MAX_CACHED_CALLS calls,
 * the oldest are dropped and read again when needed.
 */
type Cache = Map<string, Transcript>;

/** Roughly how many calls the cache keeps, beyond those of the directory counted last. */
export const MAX_CACHED_CALLS = 100_000;

/** A transcript is read in parts this size, so one huge file never becomes one huge string. */
const CHUNK = 8 * 1024 * 1024;

interface Run {
  promise: Promise<Usage>;
  /** Stops the count once nobody who asked for it is still waiting. */
  stop: AbortController;
  waiters: number;
}

/** How long one count may take before it stops; what it read by then stays counted. */
const TIME_LIMIT_MS = 60_000;

/** A count that stopped before it finished, because it took too long or nobody wanted it. */
export class CountStopped extends Error {}

/**
 * A counter with its own cache of transcripts and its own queue: counts made through it run one at
 * a time and reuse what earlier ones read. Each core has one.
 */
export function usageCounter() {
  const transcripts: Cache = new Map();
  let queue: Promise<unknown> = Promise.resolve();
  /** Requests waiting their turn, so a burst of the same request runs once. */
  const waiting = new Map<string, Run>();

  /**
   * Counts the tool calls in the sessions started in `dir`, or anywhere in its repository and its
   * worktrees, since rules at a repository's root apply there too (docs: permissions#permission-system).
   * Subagents are included. It also counts the calls you approved or refused by hand, which Claude
   * Code records on each call's result as `permissionDecision` (not documented; older transcripts
   * lack it), and how many calls each rule covers. Requests run one at a time, since they share the
   * cache. A count stops when every `signal` it was asked with aborts, or after `timeLimitMs`: it
   * rejects with CountStopped and the next one starts, even if a read of the stopped count never
   * returns.
   */
  return function readUsage(
    env: ScanEnv,
    dir: string,
    rules: RuleInEffect[],
    {
      signal,
      timeLimitMs = TIME_LIMIT_MS,
      maxCachedCalls = MAX_CACHED_CALLS,
    }: { signal?: AbortSignal; timeLimitMs?: number; maxCachedCalls?: number } = {}
  ): Promise<Usage> {
    const key = JSON.stringify([env.claudeDir, resolve(dir), rules, timeLimitMs, maxCachedCalls]);
    let run = waiting.get(key);
    // Nobody would wait for a new count, so none starts to hold up the queue.
    if (!run && signal?.aborted) return Promise.reject(stoppedBecause(signal));
    if (!run) {
      const stop = new AbortController();
      const promise = queue.then(() => {
        waiting.delete(key);
        const during = AbortSignal.any([stop.signal, AbortSignal.timeout(timeLimitMs)]);
        // A stopped count answers right away, even while one of its reads never returns.
        const stopped = new Promise<never>((_, fail) => {
          const onStop = () => fail(stoppedBecause(during));
          if (during.aborted) onStop();
          else during.addEventListener("abort", onStop, { once: true });
        });
        return Promise.race([
          count(transcripts, env, resolve(dir), rules, during, maxCachedCalls),
          stopped,
        ]);
      });
      run = { promise, stop, waiters: 0 };
      waiting.set(key, run);
      // The queue moves on when the count settles or stops: a stopped count changes nothing more.
      queue = promise.catch(() => undefined);
    }
    const current = run;
    if (signal?.aborted) return current.promise;
    current.waiters++;
    signal?.addEventListener(
      "abort",
      () => {
        if (--current.waiters === 0) current.stop.abort();
      },
      { once: true }
    );
    return current.promise;
  };
}

/** Counts with a cache and queue shared by every caller in the process; use a core's instead. */
export const readUsage = usageCounter();

function stoppedBecause(signal: AbortSignal): CountStopped {
  return new CountStopped(
    signal.reason instanceof DOMException && signal.reason.name === "TimeoutError"
      ? "Counting tool calls took too long and stopped; what was read is kept, so the next count continues."
      : "The count was no longer wanted."
  );
}

/** Throws once a count has to stop, before it changes anything else. */
function checkStopped(signal: AbortSignal): void {
  if (signal.aborted) throw stoppedBecause(signal);
}

async function count(
  transcripts: Cache,
  env: ScanEnv,
  dir: string,
  rules: RuleInEffect[],
  signal: AbortSignal,
  maxCachedCalls: number
): Promise<Usage> {
  checkStopped(signal);
  const checkouts = await worktrees(dir);
  // $HOME may end in a slash or be a link, while git prints the resolved path.
  const homes = new Set([
    resolve(env.home),
    await realpath(env.home).catch(() => resolve(env.home)),
  ]);
  const isHome = (folder: string) => homes.has(resolve(folder));
  // A home directory kept in git (dotfiles) is not a project: its folders are separate projects.
  const repository = checkouts.length > 0 && !isHome(checkouts[0] ?? "");
  const folders = repository ? checkouts : [dir];
  const projects = join(env.claudeDir, "projects");
  const storeNames = await listDir(projects);
  const taken = new Set<string>();
  const calls: Call[] = [];
  const counted = new Set<string>();
  let sessions = 0;
  for (const folder of folders) {
    const own = storeDirName(folder);
    // Sessions started in a subfolder or a nested worktree have their own store, named with the
    // folder's as a prefix; the prefix also matches siblings such as app-old, so each session is
    // kept by the folder it started in. A home directory would pull in every store, so only its
    // own is read.
    const stores = storeNames.filter(
      (name) => name === own || (!isHome(folder) && name.startsWith(`${own}-`))
    );
    for (const name of stores) {
      const store = join(projects, name);
      const files = await transcriptsIn(store);
      for (const [file, session] of files) {
        if (taken.has(file)) continue;
        // A subagent's session decides; one whose session file is gone goes by its own start.
        const start =
          (await transcript(transcripts, env, session, signal))?.startCwd ??
          (await transcript(transcripts, env, file, signal))?.startCwd;
        if (start ? !isWithin(folder, start) : name !== own) continue;
        taken.add(file);
        counted.add(file);
        calls.push(...((await transcript(transcripts, env, file, signal))?.calls ?? []));
        if (file === session) sessions++;
      }
      checkStopped(signal);
      for (const path of transcripts.keys())
        if (path.startsWith(store + sep) && !files.has(path)) transcripts.delete(path);
    }
  }
  trimCache(transcripts, counted, maxCachedCalls);
  return {
    sessions,
    repository,
    since: calls.reduce<string | null>((min, c) => (min === null || c.at < min ? c.at : min), null),
    tools: toolUsage(calls),
    approvals: approvals(calls, rules),
    matches: Object.fromEntries(rules.map((r) => [r.rule, matchCount(r, calls)])),
  };
}

/** Drops the least recently counted transcripts over the limit, keeping those just counted. */
function trimCache(transcripts: Cache, counted: Set<string>, maxCalls: number): void {
  let total = 0;
  for (const known of transcripts.values()) total += known.calls.length;
  for (const [path, known] of transcripts) {
    if (total <= maxCalls || counted.has(path)) return;
    transcripts.delete(path);
    total -= known.calls.length;
  }
}

/** A store's transcripts, each with the session it belongs to: itself, or a subagent's session. */
async function transcriptsIn(store: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const name of await listDir(store)) {
    if (name.endsWith(".jsonl")) files.set(join(store, name), join(store, name));
    else if (await isDir(join(store, name, "subagents")))
      for (const sub of await listDir(join(store, name, "subagents")))
        if (sub.endsWith(".jsonl"))
          files.set(join(store, name, "subagents", sub), join(store, `${name}.jsonl`));
  }
  return files;
}

/**
 * One transcript, read up to its end; one that cannot be read keeps what was read before, and one
 * whose count stops keeps the whole lines read so far.
 */
async function transcript(
  transcripts: Cache,
  env: ScanEnv,
  file: string,
  signal: AbortSignal
): Promise<Transcript | null> {
  if (await isCredentials(env, file)) return null;
  const info = await stat(file).catch(() => null);
  checkStopped(signal);
  if (!info?.isFile()) return null;
  let known = transcripts.get(file);
  if (!known || info.size < known.offset)
    known = { size: 0, mtimeMs: 0, offset: 0, calls: [], byId: new Map() };
  // Set again so the map stays in order of last use.
  transcripts.delete(file);
  transcripts.set(file, known);
  if (known.size === info.size && known.mtimeMs === info.mtimeMs) return known;
  try {
    await readFrom(file, known, info.size, signal);
    known.size = info.size;
    known.mtimeMs = info.mtimeMs;
  } catch (error) {
    if (error instanceof CountStopped) throw error;
    // Gone or unreadable since the stat: keep what was counted; the offset still marks it.
  }
  return known;
}

/** Reads whole lines from the offset up to `size`; a line still being written is read next time. */
async function readFrom(
  file: string,
  known: Transcript,
  size: number,
  signal: AbortSignal
): Promise<void> {
  const handle = await open(file, "r");
  try {
    let carried = Buffer.alloc(0);
    let position = known.offset;
    while (position < size) {
      const chunk = Buffer.alloc(Math.min(CHUNK, size - position));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      // Checked before the cache changes: a later count may already be reading this file.
      checkStopped(signal);
      if (bytesRead === 0) break;
      position += bytesRead;
      const data = Buffer.concat([carried, chunk.subarray(0, bytesRead)]);
      const end = data.lastIndexOf(0x0a) + 1;
      for (const line of data.subarray(0, end).toString("utf8").split("\n")) read(line, known);
      known.offset += end;
      carried = data.subarray(end);
    }
  } finally {
    await handle.close();
  }
}

/** Takes the tool calls from an assistant line and your answers from a tool result line. */
function read(line: string, transcript: Transcript): void {
  const hasCall = line.includes('"tool_use"');
  const hasDecision = line.includes('"permissionDecision"');
  const hasStart = !transcript.startCwd && line.includes('"cwd"');
  if (!hasCall && !hasDecision && !hasStart) return;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(record)) return;
  if (!transcript.startCwd && typeof record.cwd === "string") transcript.startCwd = record.cwd;
  if (!isRecord(record.message)) return;
  const content = record.message.content;
  if (!Array.isArray(content)) return;
  const at = typeof record.timestamp === "string" ? record.timestamp : "";
  if (record.type === "assistant") {
    for (const block of content) {
      if (!isRecord(block) || block.type !== "tool_use") continue;
      if (typeof block.id !== "string" || typeof block.name !== "string") continue;
      const call = callOf(block.name, isRecord(block.input) ? block.input : {}, at);
      transcript.calls.push(call);
      transcript.byId.set(block.id, call);
    }
    return;
  }
  const decision = record.permissionDecision;
  if (record.type !== "user" || !isRecord(decision)) return;
  if (typeof decision.source !== "string" || !decision.source.startsWith("user")) return;
  for (const block of content) {
    if (!isRecord(block) || block.type !== "tool_result") continue;
    const call = typeof block.tool_use_id === "string" && transcript.byId.get(block.tool_use_id);
    if (call) call.byYou = decision.decision === "accept";
  }
}

function callOf(tool: string, input: Record<string, unknown>, at: string): Call {
  const command =
    (tool === "Bash" || tool === "Monitor") && typeof input.command === "string"
      ? input.command
      : undefined;
  let host: string | undefined;
  if (tool === "WebFetch" && typeof input.url === "string") {
    try {
      host = new URL(input.url).hostname.replace(/\.$/, "");
    } catch {
      // Not a URL: no domain rule can match it.
    }
  }
  const call: Call = { tool, at, rule: ruleFor(tool, command, host) };
  if (command !== undefined) call.commands = everyCommandIn(command);
  if (host !== undefined) call.host = host;
  return call;
}

function toolUsage(calls: Call[]): ToolUsage[] {
  const byTool = new Map<string, ToolUsage>();
  for (const c of calls) {
    const usage = byTool.get(c.tool) ?? { tool: c.tool, calls: 0, approved: 0, refused: 0 };
    usage.calls++;
    if (c.byYou === true) usage.approved++;
    if (c.byYou === false) usage.refused++;
    byTool.set(c.tool, usage);
  }
  return [...byTool.values()].sort((a, b) => b.calls - a.calls);
}

/**
 * Calls you allowed by hand, grouped by the allow rule that would cover them. A rule is left out
 * when it would also cover a call you refused, or when rules in effect already decide every call
 * behind it: allowing it then changes nothing.
 */
function approvals(calls: Call[], rules: RuleInEffect[]): Approval[] {
  const matchers = rules.flatMap((r) => matcherFor(r) ?? []);
  const groups = new Map<string, Call[]>();
  for (const c of calls) {
    if (c.byYou !== true) continue;
    if (c.rule) groups.set(c.rule, [...(groups.get(c.rule) ?? []), c]);
  }
  const refused = calls.filter((c) => c.byYou === false);
  const out: Approval[] = [];
  for (const [rule, approved] of groups) {
    if (rules.some((r) => r.rule === rule)) continue;
    const covers = matcherFor({ list: "allow", rule });
    if (covers && refused.some(covers)) continue;
    if (approved.every((c) => matchers.some((m) => m(c)))) continue;
    const last = approved.reduce((max, c) => (c.at > max ? c.at : max), "");
    out.push({ rule, approved: approved.length, last });
  }
  return out.sort((a, b) => b.approved - a.approved);
}

/**
 * Programs a prefix rule may name on their own: read-only commands with no flag that runs a
 * command or writes a file (docs: permissions#read-only-commands). A rule for any other program
 * could allow far more than you approved, as `sed`'s `e` command or `make --eval` do, so ccdesk
 * suggests none.
 */
const SAFE_PROGRAMS = new Set(
  "ls cat head tail wc grep diff cmp comm cut tr jq stat du df pwd echo printf date whoami uname which basename dirname realpath readlink nproc".split(
    " "
  )
);

/**
 * Programs with subcommands, and the subcommands a rule may name, one or two words each: those
 * whose flags neither run another command nor write a file you did not name
 * (docs: permissions#wildcard-patterns). The exceptions are the script runners `test`, `run`,
 * `build` and `lint`, and `git commit`, whose hooks may run scripts from package.json: they run
 * the project's own code, and npm and pnpm config flags such as `--node-options` can make them
 * run any code. A rule for them is the one Claude Code's own prompt offers, `npm test *`
 * (docs: permissions#permission-system), and no wider.
 *
 * Left out on purpose: `git stash show`, `git blame` and `git log` write anywhere with
 * `--output`; `git grep -O` and `git fetch --upload-pack` run a command; the rest of `gh repo`
 * reaches delete, visibility and deploy keys; `bun build --compile --outfile` writes an
 * executable; `npm audit fix` installs; every pnpm command loads a pnpmfile, which
 * `--config.pnpmfile` can point at any script; podman takes `--runtime` after the subcommand;
 * `go test -exec`, `cargo --config`, kubeconfig exec plugins, `pip --python` and installs run
 * whatever they are given.
 */
const SUBCOMMANDS: Record<string, string[]> = {
  git: "status add commit switch restore tag branch rev-parse describe ls-files".split(" "),
  npm: "test run ls outdated view".split(" "),
  pnpm: "test run build lint".split(" "),
  yarn: "test run build lint".split(" "),
  bun: ["test"],
  gh: [
    "status",
    "pr view",
    "pr list",
    "pr diff",
    "pr checks",
    "issue view",
    "issue list",
    "repo view",
  ],
  docker: "ps images logs inspect".split(" "),
  systemctl: ["status"],
};

/** Path rules for these need a path ccdesk should not guess. */
const PATH_TOOLS = new Set(["Read", "Edit", "Write", "NotebookEdit", "Glob", "Grep", "LSP"]);

/**
 * The allow rule that would have covered a call, in the form Claude Code's "don't ask again"
 * writes: a Bash program on the allowlists above, with its subcommand where it has them, a fetch's
 * domain, or the tool. None for compound commands, other programs and subcommands, a leading
 * variable assignment (an allow rule does not match past most of them, docs:
 * permissions#process-wrappers) and file tools. A rule takes no other words from a command, so
 * arguments never leave the server.
 */
function ruleFor(
  tool: string,
  command: string | undefined,
  host: string | undefined
): string | null {
  if (tool === "Bash") {
    if (command === undefined || /[`$<>(){}]/.test(command)) return null;
    if (/^\s*\w+=/.test(command)) return null;
    const parts = subcommands(command);
    if (parts.length !== 1) return null;
    const [program, ...rest] = (parts[0] ?? "").split(/\s+/);
    if (!program) return null;
    if (SAFE_PROGRAMS.has(program)) return `Bash(${program} *)`;
    const sub = SUBCOMMANDS[program]?.find((words) =>
      words.split(" ").every((word, i) => rest[i] === word)
    );
    return sub ? `Bash(${program} ${sub} *)` : null;
  }
  if (tool === "WebFetch") return host ? `WebFetch(domain:${host})` : null;
  if (PATH_TOOLS.has(tool) || tool === "PowerShell" || tool === "Monitor") return null;
  return tool;
}

const SEPARATORS = /&&|\|\||\|&|[;|&\n]/;
/** docs: permissions#process-wrappers */
const WRAPPERS = new Set([
  "timeout",
  "time",
  "nice",
  "nohup",
  "stdbuf",
  "command",
  "builtin",
  "noglob",
]);
const KEYWORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "!"]);

/** A command's parts as Claude Code splits them for allow rules: at shell operators, wrappers stripped. */
function subcommands(command: string): string[] {
  return command
    .split(SEPARATORS)
    .map((part) => withoutWrappers(part.trim()))
    .filter(Boolean);
}

/**
 * Every command a rule might see in a call: the whole text, its parts, and commands nested in a
 * subshell, a substitution or a loop body, which deny and ask rules also reach (docs:
 * permissions#compound-commands), each also without its redirections, which Claude Code checks
 * apart from the rule (docs: permissions#redirections). Generous on purpose, so a rule counted as
 * covering no call really covered none.
 */
function everyCommandIn(command: string): string[] {
  const variants = [command, withoutRedirections(command)];
  return [
    ...new Set(
      variants.flatMap((text) => {
        const parts = text
          .replace(/\$\(|[`(){}]/g, "\n")
          .split(SEPARATORS)
          .map((part) => {
            const words = part.trim().split(/\s+/);
            while (KEYWORDS.has(words[0] ?? "")) words.shift();
            return withoutWrappers(words.join(" "));
          });
        return [withoutWrappers(text.trim()), ...parts];
      })
    ),
  ].filter(Boolean);
}

/** `2>&1`, `> out.txt`, `&>> log`, `< in`: removed with their target, before `&` is taken for a separator. */
function withoutRedirections(command: string): string {
  return command.replace(/\s*(?:\d*>>?\|?|&>>?|\d*<)&?\s*(?:'[^']*'|"[^"]*"|[^\s;&|]*)/g, "");
}

function withoutWrappers(command: string): string {
  const words = command.split(/\s+/);
  for (;;) {
    const first = words[0] ?? "";
    if (/^\w+=/.test(first)) words.shift();
    else if (first === "xargs" && words.length > 1 && !(words[1] ?? "").startsWith("-"))
      words.shift();
    else if (
      WRAPPERS.has(first) &&
      words.length > 1 &&
      !(first === "command" && words[1] === "-v")
    ) {
      words.shift();
      while (/^(-\S+|\d+(\.\d+)?[smhd]?)$/.test(words[0] ?? "")) words.shift();
    } else break;
  }
  return words.join(" ");
}

/** How many calls a rule covers, or null for kinds ccdesk does not match (paths, parameters, PowerShell). */
function matchCount(rule: RuleInEffect, calls: Call[]): number | null {
  const matches = matcherFor(rule);
  return matches ? calls.filter(matches).length : null;
}

/** Whether a rule covers a call, erring towards yes; null for kinds ccdesk does not match. */
function matcherFor({ list, rule }: RuleInEffect): ((call: Call) => boolean) | null {
  const { tool, specifier } = parseRule(rule);
  if (specifier === null) {
    if (tool.startsWith("mcp__") && tool.split("__").length === 2)
      return (c) => c.tool.startsWith(`${tool}__`);
    // Monitor runs commands under the Bash rules (docs: tools-reference#configure-tools-with-permission-rules-and-hooks).
    return (c) =>
      namesTool(list, tool, c.tool) || (c.tool === "Monitor" && namesTool(list, tool, "Bash"));
  }
  if (tool === "Bash") {
    const pattern = bashPattern(specifier);
    if (pattern === null) return null;
    return (c) => c.commands?.some(pattern) === true;
  }
  if (tool === "WebFetch" && specifier.startsWith("domain:")) {
    const host = wildcard(specifier.slice(7).replace(/\.$/, ""), "i");
    return (c) => c.host !== undefined && host.test(c.host);
  }
  return null;
}

/** A Bash rule's command pattern (docs: permissions#wildcard-patterns); null for a parameter rule. */
function bashPattern(specifier: string): ((command: string) => boolean) | null {
  let pattern = specifier;
  if (pattern.endsWith(":*") && !pattern.slice(0, -2).includes("*"))
    pattern = `${pattern.slice(0, -2)} *`;
  else if (/^[A-Za-z_]+:/.test(pattern)) return null;
  const star = pattern.indexOf("*");
  if (pattern.endsWith(" *") && star === pattern.length - 1) {
    const prefix = pattern.slice(0, -2);
    return (command) => command === prefix || command.startsWith(`${prefix} `);
  }
  const regex = wildcard(pattern, "s");
  return (command) => regex.test(command);
}
