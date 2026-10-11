// Loaded before every test file: nothing may read or write the real home directory or network.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sandboxRoot = mkdtempSync(join(tmpdir(), "ccdesk-test-process-"));
const sandboxHome = join(sandboxRoot, "home");
mkdirSync(sandboxHome, { recursive: true });

delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
Object.assign(process.env, {
  HOME: sandboxHome,
  USERPROFILE: sandboxHome,
  XDG_CONFIG_HOME: join(sandboxRoot, "xdg-config"),
  GIT_CONFIG_GLOBAL: join(sandboxRoot, "gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
});

globalThis.fetch = async (input) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  throw new Error(`Unexpected network access from test: ${target}`);
};

process.once("exit", () => {
  rmSync(sandboxRoot, { recursive: true, force: true });
});
