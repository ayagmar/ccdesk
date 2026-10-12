import { readFile } from "node:fs/promises";
import { type AstroIntegration } from "astro";

/**
 * The README is rendered by GitHub and npm, so it cannot read astro.config.ts; this fails the
 * build when its link to the docs site no longer matches `site` and `base`.
 */
export function readmeLinksToSite(): AstroIntegration {
  return {
    name: "readme-links-to-site",
    hooks: {
      "astro:config:done": async ({ config }) => {
        if (!config.site) throw new Error("astro.config.ts must set `site`.");
        const url = new URL(config.base, config.site).href;
        const readme = await readFile(new URL("../README.md", config.root), "utf8");
        if (!readme.includes(`](${url})`))
          throw new Error(`README.md must link to the docs site at ${url}`);
      },
    },
  };
}
