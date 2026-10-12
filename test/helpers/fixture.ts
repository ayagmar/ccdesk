import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { type ScanEnv } from "../../src/server/scan/env.ts";
import { storeDirName } from "../../src/shared/memory.ts";

export interface Fixture {
  root: string;
  env: ScanEnv;
  /** Absolute path inside the fixture. */
  at(...parts: string[]): string;
  /** A path inside the fixture relative to its root, with forward slashes on every platform. */
  rel(path: string): string;
  write(path: string, content: string): string;
  json(path: string, value: unknown): string;
  link(path: string, target: string): void;
  git(dir: string, ...args: string[]): void;
}

/** A disposable machine: a home directory with ~/.claude, a managed dir and a projects folder. */
export function makeFixture(): Fixture {
  // The native realpath also expands Windows 8.3 names (C:\Users\RUNNER~1), so fixture paths match
  // the ones git and realpath report.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ccdesk-fixture-")));
  const home = join(root, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  const env: ScanEnv = {
    home,
    claudeDir: join(home, ".claude"),
    claudeJson: join(home, ".claude.json"),
    managedDir: join(root, "etc", "claude-code"),
    platform: "linux",
    processEnv: {},
  };
  const at = (...parts: string[]) => join(root, ...parts);
  const write = (path: string, content: string) => {
    const full = path.startsWith(root) ? path : at(path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    return full;
  };
  return {
    root,
    env,
    at,
    rel: (path) => relative(root, path).split(sep).join("/"),
    write,
    json: (path, value) => write(path, JSON.stringify(value, null, 2)),
    link: (path, target) => {
      const full = path.startsWith(root) ? path : at(path);
      mkdirSync(dirname(full), { recursive: true });
      symlinkSync(target, full);
    },
    git: (dir, ...args) => {
      execFileSync("git", ["-C", dir.startsWith(root) ? dir : at(dir), ...args], {
        stdio: "ignore",
      });
    },
  };
}

/** `~/.claude/projects/<name>/memory` for a project path, as Claude Code names it. */
export function memoryDirFor(fixture: Fixture, projectPath: string): string {
  return join(fixture.env.claudeDir, "projects", storeDirName(projectPath), "memory");
}

export function memoryFile(name: string, type: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`;
}
