// Regenerates the docs screenshots in src/assets/screenshots from a made-up setup, never from your
// own: it builds a throwaway home folder (demo-home.ts), starts the built ccdesk in it with a
// minimal environment and captures the pages with a headless Chromium.
//
//   pnpm --dir .. build && pnpm screenshots
//
// CHROMIUM_PATH picks the browser binary; without it Playwright's own download is used
// (`pnpm exec playwright-core install chromium`).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";
import sharp from "sharp";
import { makeDemoHome } from "./demo-home.ts";

const SITE = join(import.meta.dirname, "..");
const CLI = join(SITE, "..", "dist", "server", "cli.js");
const OUT = join(SITE, "src", "assets", "screenshots");

interface Shot {
  name: string;
  width: number;
  height: number;
  /** Gets the page into the state to capture; the page has loaded the start directory. */
  setup?: (page: Page) => Promise<void>;
  /** Query string for the page, such as "?all". */
  query?: string;
  /** Capture only this element, such as the inspector, cut to at most `height` pixels. */
  only?: string;
  /** Also record where each scope's rows are, for the landing page's tour of this shot. */
  regions?: true;
}

/** A close crop of what answers one of the landing page's questions. */
interface Crop {
  name: string;
  query?: string;
  /** Window width; a narrower window keeps a wide table's text readable. */
  width?: number;
  /** Gets the page ready and returns a row, framed with the rows around it, or an element, cut off
   * after `until` when that is given. */
  target: (page: Page) => Promise<{ row: Locator } | { element: Locator; until?: Locator }>;
}

const pause = (page: Page) => page.waitForTimeout(400);

const select = (text: string) => async (page: Page) => {
  await page.getByRole("row").filter({ hasText: text }).first().click();
  await pause(page);
};

/** Presses a section's number key, then selects a row in that section. */
const section = (key: string, title: string, row: string) => async (page: Page) => {
  await page.keyboard.press(key);
  await pause(page);
  await page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .getByRole("row")
    .filter({ hasText: row })
    .first()
    .click();
  await pause(page);
};

/** Opens a setting, types a new value and opens the diff review. */
const reviewSetting = (key: string, value: string) => async (page: Page) => {
  await select(key)(page);
  await page.getByLabel("Value in this file").fill(value);
  await page.getByRole("button", { name: "Review change" }).click();
  await pause(page);
};

/** Presses a section's number key and selects the first row there with `text`. */
const rowIn = (key: string, title: string, text: string) => async (page: Page) => {
  await page.keyboard.press(key);
  await pause(page);
  const row = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .getByRole("row")
    .filter({ hasText: text })
    .first();
  await row.click();
  await pause(page);
  return { row };
};

const SHOTS: Shot[] = [
  { name: "directory", width: 1600, height: 1000, regions: true },
  {
    name: "review",
    width: 1600,
    height: 860,
    setup: reviewSetting("model", "opus"),
    only: "aside.inspector",
  },
  {
    name: "permissions",
    width: 1600,
    height: 1000,
    setup: section("3", "Permissions", "gh pr view"),
  },
  { name: "memory", width: 1600, height: 1000, setup: section("5", "Memory", "test-database") },
  { name: "hooks", width: 1600, height: 1000, setup: section("6", "Hooks", "guard-migrations") },
  { name: "mcp", width: 1600, height: 1000, setup: section("7", "MCP servers", "postgres") },
  {
    name: "context",
    width: 1600,
    height: 1000,
    setup: async (page) => {
      await page.getByRole("button", { name: "What Claude sees" }).click();
      await pause(page);
    },
  },
  {
    name: "palette",
    width: 1600,
    height: 1000,
    setup: async (page) => {
      await page.keyboard.press("Control+k");
      await page.keyboard.type("migrat");
      await pause(page);
    },
  },
  { name: "all-directories", width: 1600, height: 1000, query: "?all" },
  {
    name: "changes",
    width: 1600,
    height: 1000,
    query: "?changes",
    setup: async (page) => {
      await page.getByRole("button", { name: "Review restore" }).last().click();
      await pause(page);
    },
  },
  { name: "phone", width: 390, height: 844 },
];

// One per question on the landing page, named by the question's id there.
const CROPS: Crop[] = [
  { name: "ask-push", target: rowIn("3", "Permissions", "git push") },
  { name: "model", target: rowIn("2", "Settings", "model") },
  { name: "agents-md", target: rowIn("1", "Instructions", "AGENTS.md") },
  {
    name: "context",
    target: async (page) => {
      await page.getByRole("button", { name: "What Claude sees" }).click();
      await pause(page);
      return {
        element: page.locator("section.context"),
        until: page.locator(".context-list > li").nth(4),
      };
    },
  },
  { name: "unused-allow", target: rowIn("3", "Permissions", "git diff") },
  { name: "suggested", target: rowIn("3", "Permissions", "suggested") },
  { name: "mcp-waiting", target: rowIn("7", "MCP servers", "sentry") },
  {
    name: "shared-memory",
    query: "?all",
    width: 1000,
    target: async (page) => ({
      element: page.locator("section").filter({ has: page.locator("#h-shared") }),
    }),
  },
];

/** The part of the page to keep for a crop: a row with two rows either side, or an element. */
async function cropBox(target: { row: Locator } | { element: Locator; until?: Locator }) {
  if ("element" in target) {
    await target.element.scrollIntoViewIfNeeded();
    const box = await target.element.boundingBox();
    const until = target.until && (await target.until.boundingBox());
    if (!box) throw new Error("The crop's element is not on the page.");
    return until ? { ...box, height: until.y + until.height - box.y } : box;
  }
  await target.row.scrollIntoViewIfNeeded();
  const row = await target.row.boundingBox();
  const table = await target.row.locator("xpath=ancestor::table[1]").boundingBox();
  if (!row || !table) throw new Error("The crop's row is not on the page.");
  // Rows are one height, so two either side end on row edges, without slivers of the next ones.
  const top = Math.max(table.y, row.y - 2 * row.height);
  const bottom = Math.min(table.y + table.height, row.y + 3 * row.height);
  return { x: table.x - 12, y: top, width: table.width + 24, height: bottom - top };
}

/**
 * Where each scope shows on the page, as fractions of the viewport: the app's own route stop and
 * the main column's rows with that scope's bullet. The landing page highlights them on the shot.
 */
function regionsOf(page: Page) {
  return page.evaluate(() => {
    const lines = ["managed", "user", "project", "local", "memory", "plugin"];
    const round = (n: number) => Math.round(n * 10000) / 10000;
    const parts = [...document.querySelectorAll(".route-stops li, tbody tr")].filter(
      (e) => !e.closest("aside")
    );
    return Object.fromEntries(
      lines.map((line) => [
        line,
        parts
          .filter((e) => e.querySelector(`.bullet-${line}`))
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.bottom > 0 && r.top < innerHeight)
          .map((r) => {
            const top = Math.max(r.top, 0);
            const bottom = Math.min(r.bottom, innerHeight);
            return [
              r.left / innerWidth,
              top / innerHeight,
              r.width / innerWidth,
              (bottom - top) / innerHeight,
            ].map(round);
          }),
      ])
    );
  });
}

/** Saves a setting change and deletes a memory, so Recent changes has something to list. */
async function makeChanges(page: Page) {
  await reviewSetting("cleanupPeriodDays", "90")(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await pause(page);
  await section("5", "Memory", "user-role")(page);
  await page.getByRole("button", { name: "Delete memory…" }).click();
  await page.getByRole("button", { name: "Delete memory", exact: true }).click();
  await pause(page);
}

async function startCcdesk(home: string, cwd: string): Promise<{ url: string; stop: () => void }> {
  if (!existsSync(CLI))
    throw new Error(`${CLI} is missing; run \`pnpm build\` in the repository first.`);
  // Only what ccdesk needs: no CLAUDE_* variables, editor or config from your own session.
  const env = { HOME: home, USERPROFILE: home, PATH: process.env.PATH ?? "", LANG: "en_US.UTF-8" };
  const child = spawn(process.execPath, [CLI, "--no-open"], { cwd, env });
  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk;
      const match = /http:\/\/\S+/.exec(output);
      if (match) resolve(match[0]);
    });
    child.once("exit", (code) => reject(new Error(`ccdesk exited with ${code}: ${output}`)));
  });
  return { url, stop: () => child.kill() };
}

async function main() {
  // A fixed path, because memory folder names spell it out on screen. Not under /tmp: ccdesk files
  // directories there under "Temporary and test dirs". mkdirSync fails if it is already there.
  const root = join(existsSync("/var/tmp") ? "/var/tmp" : tmpdir(), "ccdesk-demo");
  mkdirSync(root);
  try {
    const demo = makeDemoHome(root);
    const ccdesk = await startCcdesk(demo.home, demo.start);
    const browser = await chromium.launch(
      process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
    );
    // Start from an empty folder, so a shot dropped from SHOTS does not leave a stale image.
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    try {
      const open = async (shot: Shot, theme: "light" | "dark") => {
        const page = await browser.newPage({
          viewport: { width: shot.width, height: shot.height },
          deviceScaleFactor: 2,
          colorScheme: theme,
          reducedMotion: "reduce",
          locale: "en-US",
          timezoneId: "UTC",
        });
        const [base, token] = ccdesk.url.split("#");
        await page.goto(`${base}${shot.query ?? ""}#${token}`);
        // The page keeps a watch stream open, so wait for content rather than an idle network.
        await page.locator("h2").first().waitFor();
        await page.waitForTimeout(800);
        return page;
      };
      const regions: Record<string, unknown> = {};
      const first = await open(SHOTS[0] as Shot, "light");
      await makeChanges(first);
      await first.close();
      for (const theme of ["light", "dark"] as const) {
        for (const shot of SHOTS) {
          const page = await open(shot, theme);
          await shot.setup?.(page);
          const box = shot.only ? await page.locator(shot.only).boundingBox() : null;
          const png = await page.screenshot(
            box ? { clip: { ...box, height: Math.min(box.height, shot.height) } } : {}
          );
          await sharp(png)
            .resize({ width: Math.min((box?.width ?? shot.width) * 2, 2400) })
            .webp({ quality: 88 })
            .toFile(join(OUT, `${shot.name}-${theme}.webp`));
          if (shot.regions && theme === "light") regions[shot.name] = await regionsOf(page);
          await page.close();
          console.log(`${shot.name}-${theme}.webp`);
        }
        for (const crop of CROPS) {
          const page = await open(
            {
              name: crop.name,
              width: crop.width ?? 1600,
              height: 1000,
              ...(crop.query ? { query: crop.query } : {}),
            },
            theme
          );
          const clip = await cropBox(await crop.target(page));
          await sharp(await page.screenshot({ clip }))
            .webp({ quality: 88 })
            .toFile(join(OUT, `answer-${crop.name}-${theme}.webp`));
          await page.close();
          console.log(`answer-${crop.name}-${theme}.webp`);
        }
      }
      writeFileSync(join(OUT, "regions.json"), `${JSON.stringify(regions, null, 2)}\n`);
    } finally {
      await browser.close();
      ccdesk.stop();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
