import assert from "node:assert/strict";
import { test } from "node:test";
import { ConventionalChangelog } from "conventional-changelog";
import releaseConfig from "../.release-it.ts";
import { makeFixture } from "./helpers/fixture.ts";

/** The changelog release-it would write for a repository, with this project's preset config. */
async function changelogFor(dir: string): Promise<string> {
  const { preset } = releaseConfig.plugins["@release-it/conventional-changelog"] ?? {};
  const generator = new ConventionalChangelog(dir)
    .loadPreset(preset)
    .options({ releaseCount: 0 })
    .readRepository();
  let text = "";
  for await (const chunk of generator.write()) text += chunk;
  return text;
}

test("docs anchors in commits stay plain text in the changelog, and numbered issues link", async () => {
  const f = makeFixture();
  f.write("repo/README.md", "");
  f.git("repo", "init", "-q");
  f.git("repo", "remote", "add", "origin", "https://github.com/owner/repo.git");
  const commit = (...messages: string[]) =>
    f.git(
      "repo",
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-q",
      "--allow-empty",
      ...messages.flatMap((m) => ["-m", m])
    );
  // An anchor in the subject, the body and a breaking-change note, each read by a different part
  // of the generator.
  commit("fix: follow hooks#workspace-trust", "See permissions#rules.", "Closes #12");
  commit("feat!: drop the old flag", "BREAKING CHANGE: see settings#precedence; refs #34");

  const changelog = await changelogFor(f.at("repo"));
  assert.doesNotMatch(changelog, /\/issues\/[^\d)]/);
  assert.match(changelog, /follow hooks#workspace-trust/);
  assert.match(changelog, /see settings#precedence/);
  assert.match(changelog, /\[#12\]\(https:\/\/github\.com\/owner\/repo\/issues\/12\)/);
  assert.match(changelog, /\[#34\]\(https:\/\/github\.com\/owner\/repo\/issues\/34\)/);
});
