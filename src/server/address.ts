import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type RunningServer, type StartOptions, startServer } from "./start.ts";

/**
 * How long after a clean stop the next start takes the token over: enough to restart ccdesk. Past
 * it the token is new, so a copy left in a stale tab, the browser history or the terminal stops
 * working, and so does one another account on the machine caught while the port was free.
 */
export const REUSE_WINDOW_MS = 15 * 60 * 1000;

/** The token and port of the last run; `stoppedAt` is set when it stopped cleanly. */
interface SavedAddress {
  token: string;
  port: number;
  stoppedAt?: number;
}

/** One file per Claude folder, so each `--config-dir` profile keeps its own. */
export function addressFile(claudeDir: string): string {
  return join(claudeDir, "ccdesk", "server.json");
}

/**
 * Whether `path` is yours alone and not a link, so another account cannot have planted it in a
 * shared Claude folder. Windows has no such mode bits; its user folders are private already.
 */
async function isPrivate(path: string): Promise<boolean> {
  if (process.platform === "win32") return true;
  const info = await lstat(path);
  return !info.isSymbolicLink() && info.uid === process.getuid?.() && (info.mode & 0o077) === 0;
}

async function load(file: string): Promise<SavedAddress | null> {
  try {
    if (!(await isPrivate(dirname(file))) || !(await isPrivate(file))) return null;
    const { token, port, stoppedAt } = JSON.parse(await readFile(file, "utf8"));
    const since = Date.now() - stoppedAt;
    const valid =
      typeof token === "string" &&
      /^[\w-]{24,}$/.test(token) &&
      Number.isInteger(port) &&
      port > 0 &&
      port <= 65535 &&
      since >= 0 &&
      since < REUSE_WINDOW_MS;
    return valid ? { token, port } : null;
  } catch {
    return null;
  }
}

/** Readable by you only, written aside and renamed so a crash never leaves half a file. */
async function save(file: string, address: SavedAddress): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  if (!(await isPrivate(dirname(file)))) throw new Error(`${dirname(file)} is not private`);
  const temp = `${file}.${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(temp, `${JSON.stringify(address)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * Starts the server and saves its token and port. A start within REUSE_WINDOW_MS of a clean stop
 * takes both over, the port unless `port` asks for one and only while it is free, so a page left
 * open finds the server again. `saved` is false when the address could not be written; the server
 * runs all the same. Its `close` records the stop.
 */
export async function startSavedServer(
  options: Omit<StartOptions, "token">,
  claudeDir: string
): Promise<{ server: RunningServer; saved: boolean }> {
  const file = addressFile(claudeDir);
  const last = await load(file);
  const token = last?.token ?? randomBytes(18).toString("base64url");
  const listen = (port: number) => startServer({ ...options, token, port });
  // Any error on the saved port falls back: Windows reserves ranges of ports again after a reboot.
  const server =
    options.port === 0 && last
      ? await listen(last.port).catch(() => listen(0))
      : await listen(options.port);
  const address = { token, port: Number(new URL(server.url).port) };
  const saved = await save(file, address).then(
    () => true,
    () => false
  );
  const close = async () => {
    await server.close();
    if (saved) await save(file, { ...address, stoppedAt: Date.now() }).catch(() => undefined);
  };
  return { server: { ...server, close }, saved };
}
