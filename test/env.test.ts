import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { scanEnvFromProcess } from "../src/core/index.ts";

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
