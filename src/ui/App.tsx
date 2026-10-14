import { Component, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { type Overview, type SessionProfile } from "../shared/types.ts";
import { buildRows } from "../view/sections/index.ts";
import { type Row } from "../view/sections/types.ts";
import { ChangesPage } from "./ChangesPage.tsx";
import { ComparePage } from "./ComparePage.tsx";
import { DirectoryPage } from "./DirectoryPage.tsx";
import { tilde } from "./format.ts";
import { Icon } from "./Icon.tsx";
import { OverviewPage } from "./OverviewPage.tsx";
import { Palette } from "./Palette.tsx";
import { Rail, type TextSize } from "./Rail.tsx";
import { pageContext } from "./sections/index.ts";
import { Toast, type ToastMessage } from "./Toast.tsx";
import { type Page, pushPage, readPage } from "./url.ts";
import { useConfig } from "./useConfig.ts";

function isDark(): boolean {
  const theme = document.documentElement.dataset.theme;
  return theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

export function App() {
  const [page, setPage] = useState<Page>(readPage);
  // Open to jump, or with `compareFrom` to pick a directory to compare that one's settings with.
  const [palette, setPalette] = useState<{ compareFrom?: string } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [jump, setJump] = useState<{ id: string } | null>(null);
  const appearance = useAppearance();
  // Counts navigations, so a page opened again, or reached through history, rereads its lists' state.
  const [visit, setVisit] = useState(0);

  // A directory page opened without a path shows the directory ccdesk was started in.
  const profile = page.kind === "directory" ? page.profile : "interactive";
  const config = useConfig(page.kind === "directory" ? page.dir : null, profile);
  const { data, dir } = config;
  const overview = config.overview.state === "ready" ? config.overview.data : null;
  // An error building the rows is drawn by the page, inside its error boundary, so the rail and the
  // other pages stay usable; a reload would open the same directory and fail again.
  const built = useMemo(() => {
    if (!data) return { rows: [] };
    try {
      return { rows: buildRows(data, pageContext()) };
    } catch (error) {
      return { rows: [], error };
    }
  }, [data]);
  const { rows } = built;

  const open = useCallback((next: Page) => {
    setPage(next);
    setVisit((v) => v + 1);
    pushPage(next);
  }, []);
  // Another directory opens with the same session profile.
  const openDirectory = useCallback(
    (path: string | null) =>
      open(path === null ? { kind: "all" } : { kind: "directory", dir: path, profile }),
    [open, profile]
  );
  const changeProfile = useCallback(
    (next: SessionProfile) =>
      setPage((p) => (p.kind === "directory" ? { ...p, profile: next } : p)),
    []
  );
  useEffect(() => {
    const onPop = () => {
      setPage(readPage());
      setVisit((v) => v + 1);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => (p ? null : {}));
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const clearToast = useCallback(() => setToast(null), []);
  const { refreshOverview } = config;
  // A forgotten directory is no longer listed, so its page gives way to All directories.
  const forgotten = useCallback(
    (text: string) => {
      setToast({ text });
      open({ kind: "all" });
      refreshOverview();
    },
    [open, refreshOverview]
  );
  const pickCompared = useCallback((from: string) => setPalette({ compareFrom: from }), []);

  return (
    <div className="app">
      <Rail
        overview={overview}
        current={railCurrent(page, data?.path ?? dir)}
        overviewFailed={config.overview.state === "error"}
        changesOpen={page.kind === "changes"}
        dark={appearance.dark}
        onOpen={openDirectory}
        onChanges={() => open({ kind: "changes" })}
        onToggleTheme={appearance.toggleTheme}
        textSize={appearance.textSize}
        onTextSize={appearance.changeTextSize}
        hidden={appearance.railHidden}
        onToggleHidden={appearance.toggleRail}
      />
      <main className="main">
        {/* Navigating starts the next page afresh, so one view's error does not stick to the others. */}
        <ErrorBoundary key={visit} hint="Open another page from the rail, or reload.">
          <PageContent
            page={page}
            visit={visit}
            config={config}
            overview={overview}
            rows={rows}
            rowsError={built.error}
            jump={jump}
            onJumped={() => setJump(null)}
            onToast={setToast}
            onForgotten={forgotten}
            onOpenDirectory={openDirectory}
            onOpenPalette={() => setPalette({})}
            onProfile={changeProfile}
            onCompare={pickCompared}
          />
        </ErrorBoundary>
      </main>
      {palette && (
        <Palette
          overview={overview}
          rows={rows}
          compareFrom={palette.compareFrom}
          onClose={() => setPalette(null)}
          onCompare={(from, to) => open({ kind: "compare", dir: from, other: to })}
          onOpenDirectory={openDirectory}
          onSelectRow={(id) => setJump({ id })}
          onOpenMemory={(projectPath, path) => {
            if (projectPath !== dir) openDirectory(projectPath);
            setJump({ id: `mem:${path}` });
          }}
        />
      )}
      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}

/**
 * The directory the rail marks: this one on a directory page, null for All directories, and
 * undefined for another page or a directory not known yet (the start directory comes with the
 * overview).
 */
function railCurrent(page: Page, path: string | null): string | null | undefined {
  if (page.kind === "directory") return path ?? undefined;
  return page.kind === "all" ? null : undefined;
}

/** The theme, text size and whether the rail is hidden, kept on the document and remembered in this browser. */
function useAppearance() {
  const [dark, setDark] = useState(isDark);
  const [railHidden, setRailHidden] = useState(
    () => document.documentElement.dataset.rail === "hidden"
  );
  const [textSize, setTextSize] = useState<TextSize>(
    () => (document.documentElement.dataset.textSize as TextSize | undefined) ?? "default"
  );
  const toggleTheme = () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setDark(next === "dark");
    try {
      localStorage.setItem("ccdesk-theme", next);
    } catch {
      // The theme just won't persist.
    }
  };
  const changeTextSize = (next: TextSize) => {
    if (next === "default") delete document.documentElement.dataset.textSize;
    else document.documentElement.dataset.textSize = next;
    setTextSize(next);
    try {
      localStorage.setItem("ccdesk-text-size", next);
    } catch {
      // The size just won't persist.
    }
  };
  const toggleRail = () => {
    const next = !railHidden;
    if (next) document.documentElement.dataset.rail = "hidden";
    else delete document.documentElement.dataset.rail;
    setRailHidden(next);
    try {
      if (next) localStorage.setItem("ccdesk-rail", "hidden");
      else localStorage.removeItem("ccdesk-rail");
    } catch {
      // The choice just won't persist.
    }
  };
  return { dark, toggleTheme, textSize, changeTextSize, railHidden, toggleRail };
}

/** The page the URL names, or why it cannot be shown yet. */
function PageContent({
  page,
  visit,
  config,
  overview,
  rows,
  rowsError,
  jump,
  onJumped,
  onToast,
  onForgotten,
  onOpenDirectory,
  onOpenPalette,
  onProfile,
  onCompare,
}: {
  page: Page;
  visit: number;
  config: ReturnType<typeof useConfig>;
  overview: Overview | null;
  rows: Row[];
  /** Why the rows could not be built; thrown here, inside the page's error boundary. */
  rowsError?: unknown;
  jump: { id: string } | null;
  onJumped: () => void;
  onToast: (toast: ToastMessage) => void;
  onForgotten: (text: string) => void;
  onOpenDirectory: (path: string | null) => void;
  onOpenPalette: () => void;
  onProfile: (profile: SessionProfile) => void;
  onCompare: (from: string) => void;
}) {
  const { view, data, reload, retry, following } = config;
  if (config.overview.state === "error")
    return (
      <Problem
        lead="ccdesk could not list your directories."
        reason={config.overview.message}
        onRetry={retry}
      />
    );
  if (page.kind === "changes")
    return (
      <ChangesPage
        onRestored={(text) => {
          onToast({ text });
          reload();
        }}
      />
    );
  if (page.kind === "compare")
    return (
      <ComparePage
        key={visit}
        dir={page.dir}
        other={page.other}
        onOpen={onOpenDirectory}
        onPickOther={() => onCompare(page.dir)}
      />
    );
  if (page.kind === "all")
    return overview ? (
      <OverviewPage
        key={visit}
        overview={overview}
        onOpen={onOpenDirectory}
        onForgotten={onForgotten}
      />
    ) : (
      <Loading />
    );
  if (config.reference.state === "error")
    return (
      <Problem
        lead="ccdesk could not load Claude Code's settings reference."
        reason={config.reference.message}
        onRetry={retry}
      />
    );
  if (view.state === "error")
    return (
      <Problem
        lead={
          config.dir
            ? `ccdesk could not read ${tilde(config.dir)}.`
            : "ccdesk could not read this directory."
        }
        reason={view.message}
        onRetry={retry}
      />
    );
  if (!data) return <Loading />;
  if (rowsError) throw rowsError;
  return (
    <DirectoryPage
      key={`${data.path}:${visit}`}
      view={data}
      overview={overview}
      rows={rows}
      jump={jump}
      onJumped={onJumped}
      reload={reload}
      following={following}
      onToast={onToast}
      onForgotten={onForgotten}
      onOpenDirectory={onOpenDirectory}
      onOpenPalette={onOpenPalette}
      onProfile={onProfile}
      onCompare={onCompare}
    />
  );
}

function Loading() {
  return (
    <div className="loading" role="status">
      <span className="loading-line" aria-hidden="true" />
      Reading your config…
    </div>
  );
}

/**
 * An error while drawing shows where it happened instead of leaving the app blank. Around a page,
 * the rail still leads elsewhere; around the whole app (main.tsx), reloading is the way out. React
 * logs the error and its component stack to the console.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; hint: string },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <Problem
        lead="ccdesk could not show this page."
        reason={this.state.error.message}
        hint={this.props.hint}
      />
    );
  }
}

/**
 * A page that could not be shown, in the problems notice: what failed, the reason as given, and
 * the way on, a retry where asking again can help or a hint where it cannot.
 */
function Problem({
  lead,
  reason,
  hint,
  onRetry,
}: {
  lead: string;
  reason: string;
  hint?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="problem" role="alert">
      <section className="problems">
        <Icon name="warn" />
        <div>
          <h1>{lead}</h1>
          <p>{/[.!?]$/.test(reason) ? reason : `${reason}.`}</p>
          {hint && <p>{hint}</p>}
          {onRetry && (
            <button type="button" className="head-action" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
