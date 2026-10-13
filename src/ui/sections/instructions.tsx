import { STATUS } from "../../view/sections/instructions.ts";
import { type RowOf } from "../../view/sections/types.ts";
import { Bullet } from "../Bullet.tsx";
import { ago, relativeTo, sharedWithAgents } from "../format.ts";
import { Icon } from "../Icon.tsx";
import { Contents, Field, LinkMark, NameButton, PathValue, VisibilityTag } from "./kit.tsx";
import { type SectionUi } from "./types.ts";

type R = RowOf<"instructions">;

const VERDICT = { loaded: "ok", "on-match": "", skipped: "off" } as const;

export const instructions: SectionUi<R> = {
  cells: (row, { view }, select) => {
    const i = row.item;
    return (
      <>
        <td className="num">{row.order}</td>
        <td>
          <Bullet line={row.line} hollow={i.status !== "loaded"} />
        </td>
        <td className="mono">
          <NameButton onClick={select}>{relativeTo(i.path, view.path)}</NameButton>
          <LinkMark realPath={i.realPath} />
          {i.checks.length > 0 && (
            <span className="flag warn" title={i.checks.join("\n")}>
              <Icon name="warn" /> {i.checks.length}
            </span>
          )}
        </td>
        <td>
          <span className={`status status-${i.status}`}>{STATUS[i.status]}</span>
        </td>
        <td className="why">{i.reason}</td>
        <td className="num">{i.lines}</td>
        <td>
          <VisibilityTag value={i.visibility} scope={i.scope} />
        </td>
      </>
    );
  },
  Details: ({ row }) => {
    const i = row.item;
    return (
      <>
        <p className={`verdict ${VERDICT[i.status]}`}>{i.reason}</p>
        {i.checks.length > 0 && (
          <ul className="plain checks-list">
            {i.checks.map((c) => (
              <li key={c} className="flag warn">
                <Icon name="warn" /> {c}
              </li>
            ))}
          </ul>
        )}
        <dl className="fields">
          <Field label="File">
            <PathValue path={i.path} />
          </Field>
          {i.realPath && (
            <Field label="Links to">
              <PathValue path={i.realPath} />
            </Field>
          )}
          {sharedWithAgents(i.realPath) && (
            <Field label="Shared with">other coding agents that read ~/.agents</Field>
          )}
          <Field label="Visibility">
            <VisibilityTag value={i.visibility} scope={i.scope} />
          </Field>
          <Field label="Size">
            {i.lines} lines · {(i.bytes / 1024).toFixed(1)} KB
          </Field>
          {i.mtime && <Field label="Changed">{ago(i.mtime)}</Field>}
          {i.paths && (
            <Field label="Applies to">
              <span className="mono">{i.paths.join(", ")}</span>
            </Field>
          )}
        </dl>
        {i.imports.length > 0 && (
          <section className="sub">
            <h3>Imports</h3>
            <ul className="plain">
              {i.imports.map((imp) => (
                <li key={`${imp.via}:${imp.resolved}`} className="mono">
                  @{imp.raw}
                  {imp.via !== i.path && (
                    <span className="muted"> via {imp.via.split(/[/\\]/).pop()}</span>
                  )}
                  {!imp.exists && <span className="flag bad">missing</span>}
                  {imp.tooLarge && <span className="flag warn">over 4 MiB, not loaded</span>}
                  {imp.skipped === "excluded" && (
                    <span className="flag">excluded by claudeMdExcludes, not loaded</span>
                  )}
                  {imp.skipped === "not-text" && (
                    <span className="flag">not a text file, not loaded</span>
                  )}
                  {imp.external && <span className="flag">outside this project</span>}
                  {imp.pending && (
                    <span
                      className="flag warn"
                      title="Claude Code asks before loading imports from outside the project"
                    >
                      waits for your approval
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <Contents text={i.text} />
      </>
    );
  },
};
