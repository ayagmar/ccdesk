type DiffLine = { kind: "same" | "add" | "remove"; text: string };

function splitLines(text: string): string[] {
  return text === "" ? [] : text.replace(/\n$/, "").split("\n");
}

/** Above this many line pairs the changed middle is shown as removed, then added. */
const MAX_CELLS = 4_000_000;

/**
 * Line diff: lines shared at the start and end are matched directly, and the changed middle by
 * longest common subsequence, unless it is too large for that.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const same = (text: string): DiffLine => ({ kind: "same", text });
  return [
    ...a.slice(0, start).map(same),
    ...middle(a.slice(start, a.length - end), b.slice(start, b.length - end)),
    ...a.slice(a.length - end).map(same),
  ];
}

function middle(a: string[], b: string[]): DiffLine[] {
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS)
    return [
      ...a.map((text): DiffLine => ({ kind: "remove", text })),
      ...b.map((text): DiffLine => ({ kind: "add", text })),
    ];
  const width = b.length + 1;
  // lcs[i * width + j] is the common length of a[i..] and b[j..].
  const lcs = new Int32Array((a.length + 1) * width);
  const at = (row: number, col: number) => lcs[row * width + col] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] ?? "" });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || at(i, j + 1) > at(i + 1, j))) {
      out.push({ kind: "add", text: b[j] ?? "" });
      j++;
    } else {
      out.push({ kind: "remove", text: a[i] ?? "" });
      i++;
    }
  }
  return out;
}

type DiffRow = DiffLine | { kind: "skip"; count: number };

/** Keeps `context` unchanged lines around each change and folds longer unchanged runs. */
export function withContext(lines: DiffLine[], context = 3): DiffRow[] {
  // Distance to the nearest change, in lines, looking both ways.
  const distance = lines.map((l) => (l.kind === "same" ? Number.POSITIVE_INFINITY : 0));
  for (let i = 1; i < lines.length; i++)
    distance[i] = Math.min(distance[i] ?? 0, (distance[i - 1] ?? 0) + 1);
  for (let i = lines.length - 2; i >= 0; i--)
    distance[i] = Math.min(distance[i] ?? 0, (distance[i + 1] ?? 0) + 1);
  const out: DiffRow[] = [];
  lines.forEach((line, i) => {
    if ((distance[i] ?? 0) <= context) {
      out.push(line);
      return;
    }
    const last = out[out.length - 1];
    if (last?.kind === "skip") last.count++;
    else out.push({ kind: "skip", count: 1 });
  });
  return out;
}
