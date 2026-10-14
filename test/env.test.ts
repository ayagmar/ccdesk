import assert from "node:assert/strict";
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
