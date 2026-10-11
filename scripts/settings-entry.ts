import { type Settings } from "@anthropic-ai/claude-agent-sdk";

/** A uniquely named alias: `Settings` alone also matches Node's http2 type. */
export interface ClaudeCodeSettings extends Settings {}
