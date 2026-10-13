// Loaded before every test file: nothing may read or write the real home directory or network,
// or start a real editor or claude.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const sandboxRoot = mkdtempSync(join(tmpdir(), "ccdesk-test-process-"));
const sandboxHome = join(sandboxRoot, "home");
mkdirSync(sandboxHome, { recursive: true });
// Fixtures are made in tmpdir(), so pointing it here removes them with the sandbox.
const sandboxTmp = join(sandboxRoot, "tmp");
mkdirSync(sandboxTmp);

// Programs that fail without doing anything, first on PATH, so code that wrongly falls back to this
// process's environment cannot start the real claude or an editor.
const sandboxBin = join(sandboxRoot, "bin");
mkdirSync(sandboxBin);
const stub = (name) => {
  if (process.platform === "win32") {
    const path = join(sandboxBin, `${name}.cmd`);
    writeFileSync(path, "@exit /b 1\r\n");
    return path;
  }
  const path = join(sandboxBin, name);
  writeFileSync(path, "#!/bin/sh\nexit 1\n");
  chmodSync(path, 0o755);
  return path;
};
stub("claude");
const editor = stub("ccdesk-test-editor");

delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
delete process.env.VISUAL;
delete process.env.EDITOR;
Object.assign(process.env, {
  HOME: sandboxHome,
  TMPDIR: sandboxTmp,
  TMP: sandboxTmp,
  TEMP: sandboxTmp,
  USERPROFILE: sandboxHome,
  XDG_CONFIG_HOME: join(sandboxRoot, "xdg-config"),
  GIT_CONFIG_GLOBAL: join(sandboxRoot, "gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  PATH: `${sandboxBin}${delimiter}${process.env.PATH}`,
  // Used alone when set, so no editor found on PATH is tried. Quoted in case the path has spaces.
  CCDESK_EDITOR: `"${editor}"`,
});

globalThis.fetch = async (input) => {
  const target = input instanceof Request ? input.url : String(input);
  throw new Error(`Unexpected network access from test: ${target}`);
};

const removeSandbox = () => rmSync(sandboxRoot, { recursive: true, force: true });
process.once("exit", removeSandbox);
// "exit" does not run when a signal ends the process, as Ctrl+C does.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    removeSandbox();
    // Listening replaced the signal's default; the test runner may have its own handler.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  });
}
