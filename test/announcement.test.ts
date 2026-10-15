import assert from "node:assert/strict";
import { test } from "node:test";
import { announcement, claudeCodeNotes, releaseNotes, targetOf } from "../scripts/announcement.ts";

const OURS = `# Changelog

## [0.4.3](https://github.com/ayagmar/ccdesk/compare/v0.4.2...v0.4.3) (2026-10-15)

### Features

* **ui:** a way back from What Claude sees ([4b6995c](https://github.com/ayagmar/ccdesk/commit/4b6995c84de34b2675521fdd3537d4d1dc91db3c))

### Bug Fixes

* **core:** cite [memory#how-it-works](https://code.claude.com/docs/en/memory#how-it-works) for the limit ([bd6da38](https://github.com/ayagmar/ccdesk/commit/bd6da38))

## [0.4.2](https://github.com/ayagmar/ccdesk/compare/v0.4.1...v0.4.2) (2026-10-14)

### Features

* **ui:** hide the rail ([7010cf4](https://github.com/ayagmar/ccdesk/commit/7010cf4))

## [0.4.1](https://github.com/ayagmar/ccdesk/compare/v0.4.0...v0.4.1) (2026-10-14)
`;

const THEIRS = `# Changelog

## 2.1.300

- Added \`virtualText\` to a mod's prompt decorations
- Fixed \`<Tab>\` & \`/autocompact\` warning about high token usage

## 2.1.299

- Added the \`prompt.change\` mod hook

## 2.1.298

- Fixed a login refused by \`forceLoginOrgUUID\`
`;

const CLAUDE_CODE_URL = "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md";
const RELEASE_URL = "https://github.com/ayagmar/ccdesk/releases/tag/v0.4.3";

const moved = {
  version: "0.4.3",
  releaseUrl: RELEASE_URL,
  changelog: OURS,
  claudeCode: { from: "2.1.299", to: "2.1.300", changelog: THEIRS, url: CLAUDE_CODE_URL },
};

test("the release notes are one version's bullets, in plain text", () => {
  assert.deepEqual(releaseNotes(OURS, "0.4.3"), [
    "ui: a way back from What Claude sees",
    "core: cite memory#how-it-works for the limit",
  ]);
  assert.deepEqual(releaseNotes(OURS, "0.4.1"), []);
});

test("Claude Code's notes cover every version after the last release, up to the new one", () => {
  assert.deepEqual(claudeCodeNotes(THEIRS, "2.1.298", "2.1.300"), [
    "Added `virtualText` to a mod's prompt decorations",
    "Fixed `<Tab>` & `/autocompact` warning about high token usage",
    "Added the `prompt.change` mod hook",
  ]);
  assert.deepEqual(claudeCodeNotes(THEIRS, "2.1.299", "2.1.299"), []);
});

test("a Discord webhook gets an embed with bold headings, a list and a linked title", () => {
  const [embed] = announcement(moved, "discord").embeds;
  assert.equal(embed.title, "ccdesk v0.4.3");
  assert.equal(embed.url, RELEASE_URL);
  assert.equal(embed.footer.text, "npx ccdesk@0.4.3");
  assert.equal(
    embed.description,
    [
      "Tracks Claude Code **2.1.300**, up from 2.1.299.",
      "",
      "**Changes in ccdesk**",
      "- ui: a way back from What Claude sees",
      "- core: cite memory#how-it-works for the limit",
      "",
      "**New in Claude Code since 2.1.299**",
      "- Added `virtualText` to a mod's prompt decorations",
      "- Fixed `<Tab>` & `/autocompact` warning about high token usage",
    ].join("\n")
  );
});

test("a Slack webhook gets blocks, with its own markup escaped where Slack reads it", () => {
  const payload = announcement(moved, "slack");
  assert.equal(payload.text, "ccdesk v0.4.3: tracks Claude Code 2.1.300");
  const texts = payload.blocks.map((b) =>
    b.type === "context" ? b.elements[0].text : b.text.text
  );
  assert.deepEqual(texts, [
    "ccdesk v0.4.3",
    `Tracks Claude Code *2.1.300*, up from 2.1.299.\n<${RELEASE_URL}|Release notes>`,
    "*Changes in ccdesk*\n• ui: a way back from What Claude sees\n• core: cite memory#how-it-works for the limit",
    "*New in Claude Code since 2.1.299*\n• Added `virtualText` to a mod's prompt decorations\n• Fixed `&lt;Tab&gt;` &amp; `/autocompact` warning about high token usage",
    "`npx ccdesk@0.4.3`",
  ]);
});

test("a data-only release with the same pin names the version it tracks and nothing else", () => {
  const [embed] = announcement(
    {
      ...moved,
      version: "0.4.1",
      claudeCode: { ...moved.claudeCode, from: "2.1.299", to: "2.1.299" },
    },
    "discord"
  ).embeds;
  assert.equal(
    embed.description,
    "Tracks Claude Code **2.1.299**.\n\nNothing changed in ccdesk itself."
  );
});

test("without Claude Code's changelog the card links to it instead of listing", () => {
  const [embed] = announcement(
    { ...moved, claudeCode: { ...moved.claudeCode, changelog: null } },
    "discord"
  ).embeds;
  assert.match(
    embed.description,
    /\[What changed in Claude Code\]\(https:\/\/github\.com\/anthropics/
  );
  assert.doesNotMatch(embed.description, /New in Claude Code/);
});

test("long lists stop at eight bullets and link to the rest", () => {
  const bullets = Array.from({ length: 11 }, (_, i) => `- Fixed thing ${i + 1}`).join("\n");
  const [embed] = announcement(
    { ...moved, claudeCode: { ...moved.claudeCode, changelog: `## 2.1.300\n\n${bullets}\n` } },
    "discord"
  ).embeds;
  assert.match(
    embed.description,
    /- Fixed thing 8\n\[and 3 more\]\(https:\/\/github\.com\/anthropics/
  );
  assert.doesNotMatch(embed.description, /Fixed thing 9/);
});

test("the target comes from the webhook's host", () => {
  assert.equal(targetOf("https://discord.com/api/webhooks/1/abc"), "discord");
  assert.equal(targetOf("https://hooks.slack.com/services/T1/B1/xyz"), "slack");
});
