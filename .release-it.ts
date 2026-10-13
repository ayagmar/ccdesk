// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${version} is filled in by release-it, not a template string.
import { type Config } from "release-it";

export default {
  git: {
    requireBranch: "master",
    requireCleanWorkingDir: true,
    requireUpstream: true,
    commitMessage: "chore(release): v${version}",
    tagName: "v${version}",
    tagAnnotation: "Release v${version}",
  },
  github: {
    release: true,
    releaseName: "v${version}",
  },
  npm: {
    publish: false,
  },
  plugins: {
    "@release-it/conventional-changelog": {
      preset: {
        name: "conventionalcommits",
      },
      infile: "CHANGELOG.md",
      header: "# Changelog",
      parserOpts: {
        // Only "#" and digits is an issue. Commit bodies cite docs sections such as
        // hooks#workspace-trust, which the default prefix turns into links to issues that do not
        // exist. A RegExp is why this file is TypeScript rather than JSON.
        issuePrefixes: [/#(?=\d)/],
      },
    },
  },
} satisfies Config;
