import { join, resolve } from "node:path";
import { type AgentEdit, type Change, type SettingsEditPreview } from "../shared/types.ts";
import { type ScanEnv } from "./scan/env.ts";
import { gitRoot, revisionOf, shownText } from "./scan/files.ts";
import { scanDirectory } from "./scan/index.ts";
import { agentProblems } from "./scan/inventory.ts";
import {
  RefusedError,
  readIfExists,
  recordChange,
  removeExactly,
  serially,
  StaleError,
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
  const folder =
    scope === "user"
      ? join(env.claudeDir, "agents")
      : join((await gitRoot(dir)) ?? dir, ".claude", "agents");
  return join(folder, `${file}.md`);
}

interface Planned {
  path: string;
  raw: string | null;
  preview: SettingsEditPreview;
}

async function plan(env: ScanEnv, edit: AgentEdit): Promise<Planned> {
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
  return {
    path,
    raw,
    preview: {
      path,
      before,
      after: errors.length > 0 ? (before ?? "") : (shownText(edit.text) ?? ""),
      revision: revisionOf(raw),
      reformats: false,
      errors,
    },
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
  expectedRevision: string
): Promise<Change> {
  return serially(async () => {
    const { path, raw, preview } = await plan(env, edit);
    if (preview.errors.length > 0) throw new RefusedError(preview.errors.join(" "));
    if (preview.revision !== expectedRevision)
      throw new RefusedError("The agent changed since you reviewed this; review it again.");
    const { text } = edit;
    return recordChange(env, { kind: "agent", target: path, before: raw }, async () => {
      if (text !== null) await writeAtomic(env, path, text, expectedRevision);
      else if (!(await removeExactly(path, expectedRevision)))
        throw new StaleError(`${path} changed while ccdesk deleted it; nothing was deleted.`);
      return { target: path, revision: revisionOf(text) };
    });
  });
}
