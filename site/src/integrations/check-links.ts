import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type AstroIntegration } from "astro";

/** Every file under `dir`, as paths relative to it with forward slashes. */
function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => statSync(join(dir, path)).isFile())
    .map((path) => path.split(sep).join("/"));
}

/**
 * Fails the build when a link inside the site points at a page, file or heading that was not
 * built: href and src attributes in the HTML, and the absolute links in the .md pages and llms
 * files. Search pages and Starlight's own assets are checked like any other link.
 */
export function checkLinks(): AstroIntegration {
  // Added again from its own setup, so it lands after the integrations Starlight adds (the
  // sitemap among them) and its build:done hook sees their files.
  return {
    name: "check-links-setup",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        updateConfig({ integrations: [checker()] });
      },
    },
  };
}

/**
 * The links a built file holds: every href, src and srcset entry of a page, and the links to this
 * site in a Markdown or text file.
 */
function linksIn(path: string, site: string): string[] {
  if (path.endsWith(".html")) {
    // A canonical link names the page itself, and the 404 page's is a URL nothing serves.
    const html = readFileSync(path, "utf8").replace(/<link rel="canonical"[^>]*>/g, "");
    return [
      ...[...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1] ?? ""),
      ...[...html.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((m) =>
        (m[1] ?? "").split(",").map((part) => part.trim().split(/\s+/)[0] ?? "")
      ),
    ];
  }
  if (!/\.(md|txt)$/.test(path)) return [];
  const text = readFileSync(path, "utf8");
  return [...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)]
    .map((m) => m[1] ?? "")
    .filter((link) => link.startsWith(site));
}

function checker(): AstroIntegration {
  let base = "/";
  let site = "";
  return {
    name: "check-links",
    hooks: {
      "astro:config:done": ({ config }) => {
        base = config.base.endsWith("/") ? config.base : `${config.base}/`;
        site = new URL(base, config.site).href;
      },
      "astro:build:done": ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const all = files(root);
        const ids = new Map<string, Set<string>>();
        const idsOf = (file: string) => {
          let found = ids.get(file);
          if (!found) {
            const html = readFileSync(join(root, file), "utf8");
            found = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? ""));
            ids.set(file, found);
          }
          return found;
        };
        // A URL path under the base, to the built file it names.
        const target = (path: string): string | null => {
          if (!path.startsWith(base)) return null;
          const inside = decodeURIComponent(path.slice(base.length));
          for (const file of [inside, `${inside}index.html`, `${inside}/index.html`])
            if (file !== "" && existsSync(join(root, file)) && statSync(join(root, file)).isFile())
              return file;
          return inside === "" && existsSync(join(root, "index.html")) ? "index.html" : null;
        };
        const broken: string[] = [];
        const check = (from: string, link: string, pageUrl: URL) => {
          if (/^(mailto:|data:|javascript:|#$)/.test(link)) return;
          const url = new URL(link.replaceAll("&amp;", "&"), pageUrl);
          if (url.origin !== pageUrl.origin) return;
          const file = target(url.pathname);
          if (!file) return void broken.push(`${from}: ${link}`);
          const hash = decodeURIComponent(url.hash.slice(1));
          if (hash && file.endsWith(".html") && !idsOf(file).has(hash))
            broken.push(`${from}: ${link} (no #${hash})`);
        };

        for (const file of all) {
          const pageUrl = new URL(file.replace(/index\.html$/, ""), site);
          for (const link of linksIn(join(root, file), site)) check(file, link, pageUrl);
        }
        if (broken.length)
          throw new Error(
            `Broken links in ${relative(process.cwd(), root)}:\n${broken.join("\n")}`
          );
        logger.info(`Checked the links in ${all.length} files.`);
      },
    },
  };
}
