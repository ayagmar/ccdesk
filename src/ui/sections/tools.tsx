import { useState } from "react";
import { EDITABLE_SCOPES } from "../../shared/scopes.ts";
import {
  type BuiltinTool,
  type DirectoryView,
  type Permission,
  type Scope,
  type Usage,
} from "../../shared/types.ts";
import { lineName } from "../../view/lines.ts";
import { outcome } from "../../view/sections/tools.ts";
import { type RowOf } from "../../view/sections/types.ts";
import { sessionsHere } from "../../view/usage.ts";
import { Bullet } from "../Bullet.tsx";
import { plural, tilde } from "../format.ts";
import { Icon } from "../Icon.tsx";
import { fileFor, ScopePicker, usePermissionChange } from "../PermissionEditor.tsx";
import { Field, NameButton } from "./kit.tsx";
import { type Actions, type SectionUi } from "./types.ts";

type R = RowOf<"tools">;

/** What the transcripts say about the tool here, as one sentence. */
function usedHere(usage: Usage | null | undefined, name: string): string {
  if (usage === undefined) return "counting…";
  if (usage === null) return "ccdesk could not finish counting the transcripts";
  if (usage.sessions === 0) return "no sessions here yet";
  const tool = usage.tools.find((t) => t.tool === name);
  if (!tool) return `not called in ${sessionsHere(usage)}`;
  const asked = tool.approved + tool.refused;
  return `${plural(tool.calls, "call")} in ${sessionsHere(usage)}${
    asked > 0 ? `; asked you ${plural(asked, "time")}, you refused ${tool.refused}` : ""
  }`;
}

function explanation(tool: BuiltinTool): string {
  const rule = tool.decidedBy;
  const where = rule ? `${rule.rule} in ${lineName(rule.scope).toLowerCase()} settings` : "";
  switch (tool.verdict) {
    case "denied":
      return `Denied by ${where}, so Claude Code removes the tool from Claude's context.`;
    case "asks":
      return `Claude asks you every time it wants this tool, because of ${where}.`;
    case "allowed":
      return `Claude uses it without asking, because of ${where}, unless a rule below for some uses denies or asks first.`;
    case "default":
      if (tool.name === "EndConversation")
        return "No permission rule or PreToolUse hook applies to this tool while Claude has any other tool, so it is never blocked and never asks.";
      return tool.asks
        ? "No rule names the whole tool, so Claude asks before using it."
        : "No rule names the whole tool, and it needs no approval. File tools still ask for paths outside the working directories.";
  }
}

/** The mode sessions start in here: the defaultMode that is in effect, as the Permissions section shows it. */
function startingMode(view: DirectoryView): string {
  const mode = view.permissions.find((p) => p.kind === "defaultMode" && p.inEffect);
  return mode?.kind === "defaultMode" ? mode.value : "default";
}

type Rule = Extract<Permission, { kind: "rule" }>;

/** The rules in files that remove the whole tool, as the scan found them, with their files. */
function removingRules(view: DirectoryView, tool: BuiltinTool): Rule[] {
  return view.permissions.filter(
    (p): p is Rule =>
      p.kind === "rule" &&
      p.inEffect &&
      (tool.removedBy ?? []).some(
        (r) => r.list === p.list && r.rule === p.rule && r.scope === p.scope
      )
  );
}

/**
 * Turns a tool off with a deny rule in the file you pick, or back on by removing the rules that
 * remove it. A tool denied in any file stays off whatever other files say (docs: permissions).
 */
function ToolSwitch({ tool, actions }: { tool: BuiltinTool; actions: Actions }) {
  const { view } = actions;
  const change = usePermissionChange(view, actions.onSaved);
  const [picking, setPicking] = useState(false);
  const [scope, setScope] = useState<Scope>("user");
  if (tool.name === "EndConversation") return null;

  const rules = removingRules(view, tool);
  if (tool.verdict === "denied" && rules.length > 0) {
    const locked = rules.filter((r) => !EDITABLE_SCOPES.includes(r.scope));
    return (
      <section className="sub editor" aria-label="Turn back on">
        <h3>Turn back on</h3>
        {locked.length > 0 ? (
          <p className="muted small">
            Managed settings turn it off, so it stays off whatever your files say.
          </p>
        ) : (
          <>
            <p className="muted small">
              {rules.length === 1
                ? "Removing this rule gives Claude the tool again."
                : "Each of these rules turns it off; remove all of them to give Claude the tool again."}
            </p>
            <ul className="plain">
              {rules.map((r) => (
                <li key={`${r.path}:${r.rule}`} className="tool-switch-rule">
                  <Bullet line={r.scope} /> <span className="mono">{r.rule}</span>
                  <span className="muted small">
                    {" "}
                    in {lineName(r.scope).toLowerCase()} settings
                  </span>
                  {!r.rule.includes("(") && r.rule.includes("*") && (
                    <span className="flag warn">also turns off every other tool it matches</span>
                  )}
                  <button
                    type="button"
                    className="head-action"
                    disabled={change.busy || change.reviewing}
                    onClick={() =>
                      void change.start(
                        r.path,
                        { list: "deny", rule: r.rule },
                        undefined,
                        `Removed ${r.rule} from deny`
                      )
                    }
                  >
                    Remove…
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {change.shown}
      </section>
    );
  }

  const file = fileFor(view, scope);
  return (
    <section className="sub editor" aria-label="Turn off for Claude">
      {picking ? (
        <>
          <h3>Turn off for Claude</h3>
          <p className="muted small">
            A deny rule naming the whole tool removes it from Claude's context. In your user
            settings it applies in every project; in project settings, for everyone working in this
            repository; in local settings, only for you here.
          </p>
          <ScopePicker
            view={view}
            scope={scope}
            onPick={(s) => {
              setScope(s);
              change.cancel();
            }}
          />
          <p className="muted small mono wrap">{file ? tilde(file) : ""}</p>
          {!change.reviewing && (
            <div className="editor-buttons">
              <button
                type="button"
                className="primary"
                disabled={change.busy || !file}
                onClick={() =>
                  file &&
                  void change.start(
                    file,
                    undefined,
                    { list: "deny", rule: tool.name },
                    `Turned off ${tool.name} in ${lineName(scope).toLowerCase()} settings`
                  )
                }
              >
                Review change
              </button>
              <button type="button" onClick={() => setPicking(false)}>
                Cancel
              </button>
            </div>
          )}
          {change.shown}
        </>
      ) : (
        <button type="button" className="quiet-danger" onClick={() => setPicking(true)}>
          <Icon name="block" /> Turn off for Claude…
        </button>
      )}
    </section>
  );
}

/** A description from the docs, with its `code` spans shown as code. */
function Described({ text }: { text: string }) {
  return text.split(/`([^`]+)`/).map((part, index) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a fixed text never move.
    index % 2 === 1 ? <code key={index}>{part}</code> : part
  );
}

export const tools: SectionUi<R> = {
  cells: (row, _actions, select) => {
    const t = row.item;
    const checked = t.scoped.filter((r) => !r.unchecked);
    return (
      <>
        <td>{row.line && <Bullet line={row.line} />}</td>
        <td className="mono">
          <NameButton onClick={select}>{t.name}</NameButton>
        </td>
        <td>
          <span
            className={`tool-outcome tool-${t.verdict === "default" ? (t.asks ? "asks" : "free") : t.verdict}`}
          >
            {outcome(t)}
          </span>
        </td>
        <td className="checks">
          {checked.length > 0 && (
            <span className="flag" title={checked.map((r) => `${r.list} ${r.rule}`).join("\n")}>
              {plural(checked.length, "rule")} for some uses
            </span>
          )}
          {checked.length < t.scoped.length && (
            <span className="flag warn" title="Claude Code never checks a path rule on this tool">
              {plural(t.scoped.length - checked.length, "unchecked rule")}
            </span>
          )}
          {t.hooks > 0 && <span className="flag">{plural(t.hooks, "hook")}</span>}
        </td>
        <td className={`num${row.calls ? " used" : ""}`}>
          {row.calls === undefined ? (
            "…"
          ) : row.calls === null ? (
            <span className="muted" title="ccdesk could not finish counting the transcripts">
              ?
            </span>
          ) : (
            row.calls
          )}
        </td>
        <td className="desc">
          <Described text={t.description.split(/(?<=\.)\s/)[0] ?? ""} />
        </td>
      </>
    );
  },
  Head: ({ actions }) => (
    <span className="tt-note">
      As in Manual mode; sessions here start in {startingMode(actions.view)} mode
    </span>
  ),
  Details: ({ row, actions }) => {
    const t = row.item;
    return (
      <>
        <p
          className={`verdict ${t.verdict === "denied" ? "off" : t.verdict === "allowed" || (!t.asks && t.verdict === "default") ? "ok" : ""}`}
        >
          {explanation(t)}
        </p>
        <p>
          <Described text={t.description} />
        </p>
        {t.scoped.length > 0 && (
          <section className="sub">
            <h3>Rules for some uses</h3>
            <ul className="plain">
              {t.scoped.map((r) => (
                <li key={`${r.scope}:${r.list}:${r.rule}`}>
                  <Bullet line={r.scope} /> <span className={`perm perm-${r.list}`}>{r.list}</span>{" "}
                  <span className="mono">{r.rule}</span>
                  {r.unchecked && (
                    <span className="flag warn">
                      never checked: Claude Code checks paths against Edit and Read rules only
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="muted small">
              Checked deny, then ask, then allow, before the rule for the whole tool applies.
            </p>
          </section>
        )}
        <dl className="fields">
          <Field label="Manual mode">
            {t.asks ? "asks before using it" : "no approval needed"}
          </Field>
          <Field label="Used here">{usedHere(actions.view.usage, t.name)}</Field>
          <Field label="PreToolUse hooks">
            {t.hooks === 0 ? "none" : `${plural(t.hooks, "hook")} run before each use`}
          </Field>
        </dl>
        {/* Keyed by outcome too, so a saved change starts the switch afresh. */}
        <ToolSwitch key={`${t.name}:${t.verdict}`} tool={t} actions={actions} />
        <p className="muted small">
          Permission modes other than Manual change which uses ask. Tool names and descriptions come
          from Claude Code's tools reference.
        </p>
      </>
    );
  },
};
