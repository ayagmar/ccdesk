import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { DOC_GROUPS } from "./src/docs-order.ts";
import { checkLinks } from "./src/integrations/check-links.ts";
import { readmeLinksToSite } from "./src/integrations/readme-link.ts";

// The only place the site's address is set. Pages link to each other with relative paths, and
// llms.txt, the .md pages, the sitemap and the social image build their URLs from these two values;
// the README link to the site is checked against them.
// To serve from a custom domain: site: "https://example.dev", base: "/", and add public/CNAME.
const site = "https://ayagmar.github.io";
const base = "/ccdesk/";

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  integrations: [
    readmeLinksToSite(),
    starlight({
      title: "ccdesk",
      description:
        "See and change everything that shapes Claude Code on your machine: instruction files, settings, hooks, MCP servers, subagents, skills, plugins and auto memory.",
      logo: { src: "../assets/brand/logo.png", alt: "" },
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/ayagmar/ccdesk" }],
      editLink: { baseUrl: "https://github.com/ayagmar/ccdesk/edit/master/site/" },
      customCss: [
        "@fontsource-variable/hanken-grotesk",
        "@fontsource-variable/jetbrains-mono",
        "./src/styles/theme.css",
      ],
      components: {
        Head: "./src/components/Head.astro",
        Hero: "./src/components/Hero.astro",
      },
      sidebar: DOC_GROUPS,
    }),
    checkLinks(),
  ],
});
