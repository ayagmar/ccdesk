import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { scanEnvFromProcess } from "../src/core/index.ts";
import { HKLM_POLICY, registryQuery } from "../src/core/scan/env.ts";

test("--config-dir is read like CLAUDE_CONFIG_DIR and wins over it", () => {
  process.env.CLAUDE_CONFIG_DIR = resolve("from-variable");
  try {
    const env = scanEnvFromProcess(join("profiles", "work"));

    assert.equal(env.claudeDir, resolve("profiles", "work"));
    assert.equal(env.claudeJson, resolve("profiles", "work", ".claude.json"));
    assert.equal(scanEnvFromProcess().claudeDir, resolve("from-variable"));
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

test("a relative CLAUDE_CONFIG_DIR names the same folder for ccdesk and the claude it runs", () => {
  process.env.CLAUDE_CONFIG_DIR = join("profiles", "home");
  try {
    assert.equal(scanEnvFromProcess().configDir, resolve("profiles", "home"));
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

test("a registry value is there when reg.exe exits 0, however much it prints, and not when it fails", async () => {
  // A stand-in for reg.exe: it checks the query it was given, prints more than 1 MiB as a large
  // policy would, and exits 0, or 1 for a value that is not there.
  const fakeReg = (code: number) =>
    registryQuery(
      process.execPath,
      "-e",
      `const [query, key, v, name] = process.argv.slice(1);
       if (query !== "query" || key !== ${JSON.stringify(HKLM_POLICY)} || v !== "/v" || name !== "Settings") process.exit(2);
       process.stdout.write("x".repeat(1_200_000), () => process.exit(${code}));`
    );

  assert.equal(await fakeReg(0)(HKLM_POLICY), true);
  assert.equal(await fakeReg(1)(HKLM_POLICY), false);
});

test("CLAUDE_CODE_PROJECT_DIR_NAME counts only beside CLAUDE_CONFIG_DIR, and only as a name Claude Code accepts", () => {
  const named = (configDir: string | undefined, name: string) => {
    if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = configDir;
    process.env.CLAUDE_CODE_PROJECT_DIR_NAME = name;
    return scanEnvFromProcess().projectDirName;
  };
  try {
    const profile = resolve("profile");
    assert.equal(named(profile, "work_2-a"), "work_2-a");
    assert.equal(named(undefined, "work"), undefined);
    // docs: sessions#name-the-project-directory-yourself, other values fall back to the derived name.
    for (const name of ["my.project", "../escaped", "a/b", "x".repeat(65), "con", "LPT1", "nul"])
      assert.equal(named(profile, name), undefined, name);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CODE_PROJECT_DIR_NAME;
  }
});

test("CLAUDE_CODE_PLUGIN_CACHE_DIR names the plugins root, with ~ standing for the home folder", () => {
  try {
    process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = join("~", "plugin-root");
    assert.equal(scanEnvFromProcess().pluginsDir, join(homedir(), "plugin-root"));
    process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = "plugin-root";
    assert.equal(scanEnvFromProcess().pluginsDir, resolve("plugin-root"));
    delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR;
    assert.equal(scanEnvFromProcess().pluginsDir, undefined);
  } finally {
    delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR;
  }
});
