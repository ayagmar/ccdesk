import { join, resolve } from "node:path";
import { type AgentEdit, type Change, type SettingsEditPreview } from "../shared/types.ts";
import { isUserClaudeFolder, type ScanEnv } from "./scan/env.ts";
import { revisionOf } from "./scan/files.ts";
import { gitRoot } from "./scan/git.ts";
import { scanDirectory } from "./scan/index.ts";
import { agentProblems } from "./scan/inventory.ts";
import { shownText } from "./secrets.ts";
import {
  type Planned,
  RefusedError,
  readIfExists,
  recordChange,
  removeExactly,
  reviewRevision,
  type Serially,
  StaleError,
  saveReviewed,
  writeAtomic,
} from "./write.ts";

/** The file an edit changes: an agent the scan shows here, or a new one in your or the project's folder. */
async function targetOf(env: ScanEnv, edit: AgentEdit): Promise<string> {
  const dir = resolve(edit.dir);
  if (edit.path !== undefined) {
    const agent = (await scanDirectory(env, dir)).inventory.agents.find(
      (a) => a.path === edit.path
    );
    if (!agent) throw new RefusedError("That agent is no longer here; review it again.");
    if (agent.scope !== "user" && agent.scope !== "project")
      throw new RefusedError(
        agent.scope === "plugin"
          ? "This agent comes with its plugin; change it in the plugin."
          : "Managed agents are set by your organisation."
      );
    return agent.path;
  }
  if (!edit.create)
    throw new RefusedError("An agent edit needs the agent or where a new one goes.");
  const { scope } = edit.create;
  // The folder gives the .md; a name typed with it would otherwise end in .md.md.
  const file = edit.create.file.replace(/\.md$/i, "");
  if (!/^[\w][\w.-]*$/.test(file))
    throw new RefusedError("A file name has letters, digits, '.', '-' or '_', and no folders.");
  const base = (await gitRoot(dir)) ?? dir;
  if (scope === "project" && (await isUserClaudeFolder(env, base)))
    throw new RefusedError(
      "Here .claude/agents is your own agents folder, which every project reads; create it as User."
    );
  const folder = scope === "user" ? join(env.claudeDir, "agents") : join(base, ".claude", "agents");
  return join(folder, `${file}.md`);
}

async function plan(env: ScanEnv, edit: AgentEdit): Promise<Planned<SettingsEditPreview, Change>> {
  const path = await targetOf(env, edit);
  const raw = await readIfExists(env, path);
  if (!edit.path && raw !== null)
    throw new RefusedError(`${path} already exists; open that agent to change it.`);
  const before = shownText(raw);
  // The page shows the file with env, header and URL values hidden, so a changed file written back
  // from it would lose them; it can still be deleted, as a whole.
  if (edit.text !== null && before !== raw)
    throw new RefusedError(
      `${path} has env, header or URL values ccdesk does not show; edit it in your editor instead.`
    );
  let errors = edit.text === null ? [] : agentProblems(edit.text);
  // Nor does it write values its review would hide.
  if (edit.text !== null && errors.length === 0 && shownText(edit.text) !== edit.text)
    errors = [
      "ccdesk does not write env, header or URL values it would then hide; add them in your editor instead.",
    ];
  const { text } = edit;
  return {
    preview: {
      path,
      before,
      after: errors.length > 0 ? (before ?? "") : (shownText(text) ?? ""),
      revision: await reviewRevision(path, raw),
      reformats: false,
      errors,
    },
    save: () =>
      recordChange(env, { kind: "agent", target: path, before: raw }, async () => {
        if (text !== null) await writeAtomic(env, path, text, revisionOf(raw));
        else if (!(await removeExactly(path, revisionOf(raw))))
          throw new StaleError(`${path} changed while ccdesk deleted it; nothing was deleted.`);
        return { target: path, revision: revisionOf(text) };
      }),
  };
}

export async function previewAgentEdit(
  env: ScanEnv,
  edit: AgentEdit
): Promise<SettingsEditPreview> {
  return (await plan(env, edit)).preview;
}

/** Writes or deletes an agent file, backed up first, only while it is as reviewed. */
export function saveAgentEdit(
  env: ScanEnv,
  edit: AgentEdit,
  expectedRevision: string,
  queue: Serially
): Promise<Change> {
  return saveReviewed(
    queue,
    () => plan(env, edit),
    expectedRevision,
    "The agent changed since you reviewed this; review it again."
  );
}
