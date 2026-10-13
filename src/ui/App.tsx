import { useCallback, useEffect, useMemo, useState } from "react";
import { type Overview, type SessionProfile } from "../shared/types.ts";
import { buildRows } from "../view/sections/index.ts";
import { type Row } from "../view/sections/types.ts";
import { ChangesPage } from "./ChangesPage.tsx";
import { ComparePage } from "./ComparePage.tsx";
import { DirectoryPage } from "./DirectoryPage.tsx";
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
  const rows = useMemo(() => (data ? buildRows(data, pageContext()) : []), [data]);

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
  const pickCompared = useCallback((from: string) => setPalette({ compareFrom: from }), []);

  return (
    <div className="app">
      <Rail
        overview={overview}
        current={railCurrent(page, data?.path ?? dir)}
        changesOpen={page.kind === "changes"}
        dark={appearance.dark}
        onOpen={openDirectory}
        onChanges={() => open({ kind: "changes" })}
        onToggleTheme={appearance.toggleTheme}
        textSize={appearance.textSize}
        onTextSize={appearance.changeTextSize}
      />
      <main className="main">
        <PageContent
          page={page}
          visit={visit}
          config={config}
          overview={overview}
          rows={rows}
          jump={jump}
          onJumped={() => setJump(null)}
          onToast={setToast}
          onOpenDirectory={openDirectory}
          onOpenPalette={() => setPalette({})}
          onProfile={changeProfile}
          onCompare={pickCompared}
        />
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

/** The directory the rail marks: this one on a directory page, none on All directories. */
function railCurrent(page: Page, path: string | null): string | null | undefined {
  if (page.kind === "directory") return path;
  return page.kind === "all" ? null : undefined;
}

/** The theme and text size, kept on the document and remembered in this browser. */
function useAppearance() {
  const [dark, setDark] = useState(isDark);
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
  return { dark, toggleTheme, textSize, changeTextSize };
}

/** The page the URL names, or why it cannot be shown yet. */
function PageContent({
  page,
  visit,
  config,
  overview,
  rows,
  jump,
  onJumped,
  onToast,
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
  jump: { id: string } | null;
  onJumped: () => void;
  onToast: (toast: ToastMessage) => void;
  onOpenDirectory: (path: string | null) => void;
  onOpenPalette: () => void;
  onProfile: (profile: SessionProfile) => void;
  onCompare: (from: string) => void;
}) {
  const { view, data, reload } = config;
  if (config.overview.state === "error") return <Problem message={config.overview.message} />;
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
      <OverviewPage key={visit} overview={overview} onOpen={onOpenDirectory} />
    ) : (
      <Loading />
    );
  if (view.state === "error") return <Problem message={view.message} />;
  if (!data) return <Loading />;
  return (
    <DirectoryPage
      key={`${data.path}:${visit}`}
      view={data}
      overview={overview}
      rows={rows}
      jump={jump}
      onJumped={onJumped}
      reload={reload}
      onToast={onToast}
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

function Problem({ message }: { message: string }) {
  return (
    <div className="problem" role="alert">
      <h1>Something went wrong</h1>
      <p>{message}</p>
    </div>
  );
}
