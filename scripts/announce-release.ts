// Prints the Slack incoming-webhook payload announcing the release at HEAD. The Release workflow
// posts it to RELEASE_WEBHOOK_URL; locally, pipe it to curl to preview it in your channel:
//   pnpm -s announce | curl -X POST -H 'Content-Type: application/json' --data @- "$URL"
//
// Inputs: package.json (the version), CHANGELOG.md, the Claude Code version the pinned SDK ships
// (`claudeCodeVersion` in its package.json), the SDK the previous tag pinned (its Claude Code
// version comes from npm), and Claude Code's changelog on GitHub. Only the last two leave the
// machine, and either one failing only shortens the message.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Announcement, announcement } from "./announcement.ts";

const ROOT = join(import.meta.dirname, "..");
const SDK = "@anthropic-ai/claude-agent-sdk";
const CLAUDE_CODE_CHANGELOG = "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md";
const CLAUDE_CODE_CHANGELOG_RAW =
  "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md";

interface PackageJson {
  version: string;
  repository?: { url?: string };
  devDependencies?: Record<string, string>;
  claudeCodeVersion?: string;
}

function run(file: string, args: string[]): string {
  return execFileSync(file, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function json<T>(text: string): T {
  return JSON.parse(text) as T;
}

const pkg = json<PackageJson>(readFileSync(join(ROOT, "package.json"), "utf8"));
const repo = (pkg.repository?.url ?? "").replace(/^git\+/, "").replace(/\.git$/, "");
if (!repo) throw new Error("package.json names no repository");

const sdk = json<PackageJson>(
  readFileSync(join(ROOT, "node_modules", SDK, "package.json"), "utf8")
);
const to = sdk.claudeCodeVersion;
if (!to) throw new Error(`${SDK} names no claudeCodeVersion`);

/** The Claude Code version the previous release's SDK pin tracked; `to` when there is no earlier tag. */
function previousClaudeCode(): string {
  let tag: string;
  try {
    tag = run("git", ["describe", "--tags", "--abbrev=0", "--exclude", `v${pkg.version}`, "HEAD"]);
  } catch {
    return to as string;
  }
  const pin = json<PackageJson>(run("git", ["show", `${tag}:package.json`])).devDependencies?.[SDK];
  if (!pin) return to as string;
  if (pin === sdk.version) return to as string;
  try {
    return run("npm", ["view", `${SDK}@${pin}`, "claudeCodeVersion"]) || (to as string);
  } catch (error) {
    console.error(`npm view ${SDK}@${pin}: ${String(error)}; treating the pin as unchanged`);
    return to as string;
  }
}

async function claudeCodeChangelog(): Promise<string | null> {
  try {
    const response = await fetch(CLAUDE_CODE_CHANGELOG_RAW);
    if (!response.ok) throw new Error(String(response.status));
    return await response.text();
  } catch (error) {
    console.error(`${CLAUDE_CODE_CHANGELOG_RAW}: ${String(error)}; linking to it instead`);
    return null;
  }
}

const input: Announcement = {
  version: pkg.version,
  releaseUrl: `${repo}/releases/tag/v${pkg.version}`,
  changelog: readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"),
  claudeCode: {
    to,
    from: previousClaudeCode(),
    changelog: await claudeCodeChangelog(),
    url: CLAUDE_CODE_CHANGELOG,
  },
};

process.stdout.write(`${JSON.stringify(announcement(input), null, 2)}\n`);
