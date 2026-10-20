import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type RunningServer, type StartOptions, startServer } from "./start.ts";

/** The token and port of the last run, kept so a page left open keeps working after a restart. */
interface SavedAddress {
  token: string;
  port: number;
}

/** One file per Claude folder, so each `--config-dir` profile keeps its own. */
export function addressFile(claudeDir: string): string {
  return join(claudeDir, "ccdesk", "server.json");
}

async function load(file: string): Promise<SavedAddress | null> {
  try {
    const { token, port } = JSON.parse(await readFile(file, "utf8"));
    const valid =
      typeof token === "string" &&
      /^[\w-]{24,}$/.test(token) &&
      Number.isInteger(port) &&
      port > 0 &&
      port <= 65535;
    return valid ? { token, port } : null;
  } catch {
    return null;
  }
}

/** Readable by you only, written aside and renamed so a crash never leaves half a file. */
async function save(file: string, address: SavedAddress): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomBytes(6).toString("hex")}`;
  await writeFile(temp, `${JSON.stringify(address)}\n`, { mode: 0o600 });
  await rename(temp, file);
}

/**
 * Starts the server with the token of the last run and, unless `port` asks for one, on its port
 * when that is free, then saves both. A page opened before a restart then finds the server again.
 * `saved` is false when the address could not be written; the server runs all the same.
 */
export async function startSavedServer(
  options: Omit<StartOptions, "token">,
  claudeDir: string
): Promise<{ server: RunningServer; saved: boolean }> {
  const file = addressFile(claudeDir);
  const last = await load(file);
  const token = last?.token ?? randomBytes(18).toString("base64url");
  const listen = (port: number) => startServer({ ...options, token, port });
  const server =
    options.port === 0 && last
      ? await listen(last.port).catch((error: NodeJS.ErrnoException) =>
          error.code === "EADDRINUSE" ? listen(0) : Promise.reject(error)
        )
      : await listen(options.port);
  const saved = await save(file, { token, port: Number(new URL(server.url).port) }).then(
    () => true,
    () => false
  );
  return { server, saved };
}
