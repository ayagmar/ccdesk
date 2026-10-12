import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { scanEnvFromProcess } from "../src/server/scan/env.ts";

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
