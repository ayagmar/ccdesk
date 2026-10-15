// The message posted to a chat webhook when a release is published: what changed in ccdesk, and
// what changed in Claude Code since the last release. Pure: `announce-release.ts` gathers the
// inputs and posts the result.
//
// `announcement` builds the same card in the format of one target. Discord gets an embed, Slack a
// Block Kit message; each uses its own markup, so headings are bold and the links are real on both.

export interface Announcement {
  /** The ccdesk version released, without a `v`. */
  version: string;
  /** The GitHub release page. */
  releaseUrl: string;
  /** ccdesk's CHANGELOG.md after release-it wrote it. */
  changelog: string;
  claudeCode: {
    /** The Claude Code version the released SDK pin tracks. */
    to: string;
    /** The one the previous release tracked; the same as `to` when the pin did not move. */
    from: string;
    /** Claude Code's CHANGELOG.md, or null when it could not be fetched. */
    changelog: string | null;
    /** Where to read the rest. */
    url: string;
  };
}

export type Target = "discord" | "slack";

/** The target a webhook URL posts to: Discord by its host, otherwise Slack. */
export function targetOf(webhookUrl: string): Target {
  const host = new URL(webhookUrl).hostname;
  return host === "discord.com" || host.endsWith(".discord.com") || host === "discordapp.com"
    ? "discord"
    : "slack";
}

/** How many bullets each list shows before "and N more". */
const SHOWN = 8;
/** The longest bullet; Claude Code's run to several lines. */
const BULLET = 180;
/** The docs site's accent. */
const ACCENT = 0xf2c14e;

/** Markdown links become their text, bold scopes become plain, and commit links are dropped. */
function plain(markdown: string): string {
  return markdown
    .replace(/\s*\(\[[0-9a-f]{7,}\]\([^)]*\)\)\s*$/, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+):\*\*/g, "$1:")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string): string {
  if (text.length <= BULLET) return text;
  const cut = text.lastIndexOf(" ", BULLET - 1);
  return `${text.slice(0, cut > BULLET / 2 ? cut : BULLET - 1)}…`;
}

/** The bullets of every `## heading` section a changelog has that `isHeading` accepts, in order. */
function sectionBullets(changelog: string, isHeading: (heading: string) => boolean): string[] {
  const bullets: string[] = [];
  let inside = false;
  for (const line of changelog.split("\n")) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      inside = isHeading(heading[1] ?? "");
      continue;
    }
    const bullet = /^[*-] (.+)$/.exec(line);
    if (inside && bullet) bullets.push(clip(plain(bullet[1] ?? "")));
  }
  return bullets;
}

/** What ccdesk's changelog lists under `version`, without the commit links. */
export function releaseNotes(changelog: string, version: string): string[] {
  return sectionBullets(changelog, (h) => h === version || h.startsWith(`[${version}]`));
}

function numeric(version: string): number[] {
  return version.split(".").map(Number);
}

function compare(a: string, b: string): number {
  const [x, y] = [numeric(a), numeric(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Claude Code's changelog bullets for every version after `from` up to and including `to`. */
export function claudeCodeNotes(changelog: string, from: string, to: string): string[] {
  return sectionBullets(changelog, (h) => {
    const version = /^(\d+\.\d+\.\d+)\b/.exec(h)?.[1];
    return version !== undefined && compare(version, from) > 0 && compare(version, to) <= 0;
  });
}

/** A list of bullets with a link to the rest, in either target's markup. */
interface Section {
  heading: string;
  bullets: string[];
  /** How many bullets the list left out, and where they are. */
  more: { count: number; url: string } | null;
}

/** The card, before either target's markup. */
interface Card {
  title: string;
  releaseUrl: string;
  /** The first line: which Claude Code version this release tracks. */
  tracks: { to: string; from: string | null };
  sections: Section[];
  /** Shown when ccdesk's changelog lists nothing for the version. */
  nothingOurs: boolean;
  /** Shown when the pin moved but the Claude Code changelog could not be read. */
  claudeCodeLink: string | null;
  install: string;
}

function section(heading: string, bullets: string[], url: string): Section {
  const rest = bullets.length - SHOWN;
  return {
    heading,
    bullets: bullets.slice(0, SHOWN),
    more: rest > 0 ? { count: rest, url } : null,
  };
}

function card(input: Announcement): Card {
  const { version, releaseUrl, changelog, claudeCode } = input;
  const moved = claudeCode.from !== claudeCode.to;
  const ours = releaseNotes(changelog, version);
  const theirs =
    moved && claudeCode.changelog
      ? claudeCodeNotes(claudeCode.changelog, claudeCode.from, claudeCode.to)
      : [];
  const sections: Section[] = [];
  if (ours.length > 0) sections.push(section("Changes in ccdesk", ours, releaseUrl));
  if (theirs.length > 0)
    sections.push(section(`New in Claude Code since ${claudeCode.from}`, theirs, claudeCode.url));
  return {
    title: `ccdesk v${version}`,
    releaseUrl,
    tracks: { to: claudeCode.to, from: moved ? claudeCode.from : null },
    sections,
    nothingOurs: ours.length === 0,
    claudeCodeLink: moved && theirs.length === 0 ? claudeCode.url : null,
    install: `npx ccdesk@${version}`,
  };
}

export interface DiscordPayload {
  embeds: [
    {
      title: string;
      url: string;
      description: string;
      color: number;
      footer: { text: string };
    },
  ];
}

/** Discord markdown: `**bold**`, `- ` lists, `[text](url)`. */
function discord(c: Card): DiscordPayload {
  const paragraphs: string[] = [];
  paragraphs.push(
    c.tracks.from
      ? `Tracks Claude Code **${c.tracks.to}**, up from ${c.tracks.from}.`
      : `Tracks Claude Code **${c.tracks.to}**.`
  );
  if (c.nothingOurs) paragraphs.push("Nothing changed in ccdesk itself.");
  for (const s of c.sections) {
    const lines = [`**${s.heading}**`, ...s.bullets.map((b) => `- ${b}`)];
    if (s.more) lines.push(`[and ${s.more.count} more](${s.more.url})`);
    paragraphs.push(lines.join("\n"));
  }
  if (c.claudeCodeLink) paragraphs.push(`[What changed in Claude Code](${c.claudeCodeLink})`);
  return {
    embeds: [
      {
        title: c.title,
        url: c.releaseUrl,
        description: paragraphs.join("\n\n"),
        color: ACCENT,
        footer: { text: c.install },
      },
    ],
  };
}

type SlackBlock =
  | { type: "header"; text: { type: "plain_text"; text: string } }
  | { type: "section"; text: { type: "mrkdwn"; text: string } }
  | { type: "context"; elements: [{ type: "mrkdwn"; text: string }] };

export interface SlackPayload {
  /** The notification text; the blocks are what the channel shows. */
  text: string;
  blocks: SlackBlock[];
}

/** Slack's mrkdwn reads `&`, `<` and `>` as markup. */
function slackText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Slack mrkdwn: `*bold*`, `•` bullets, `<url|text>` links, each part its own block. */
function slack(c: Card): SlackPayload {
  const mrkdwn = (text: string): SlackBlock => ({
    type: "section",
    text: { type: "mrkdwn", text },
  });
  const blocks: SlackBlock[] = [{ type: "header", text: { type: "plain_text", text: c.title } }];
  const tracks = c.tracks.from
    ? `Tracks Claude Code *${c.tracks.to}*, up from ${c.tracks.from}.`
    : `Tracks Claude Code *${c.tracks.to}*.`;
  blocks.push(mrkdwn(`${tracks}\n<${c.releaseUrl}|Release notes>`));
  if (c.nothingOurs) blocks.push(mrkdwn("Nothing changed in ccdesk itself."));
  for (const s of c.sections) {
    const lines = [`*${s.heading}*`, ...s.bullets.map((b) => `• ${slackText(b)}`)];
    if (s.more) lines.push(`<${s.more.url}|and ${s.more.count} more>`);
    blocks.push(mrkdwn(lines.join("\n")));
  }
  if (c.claudeCodeLink) blocks.push(mrkdwn(`<${c.claudeCodeLink}|What changed in Claude Code>`));
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `\`${c.install}\`` }] });
  return { text: `${c.title}: tracks Claude Code ${c.tracks.to}`, blocks };
}

/** The webhook payload for a release, in the target's format. */
export function announcement(input: Announcement, target: "discord"): DiscordPayload;
export function announcement(input: Announcement, target: "slack"): SlackPayload;
export function announcement(input: Announcement, target: Target): DiscordPayload | SlackPayload;
export function announcement(input: Announcement, target: Target): DiscordPayload | SlackPayload {
  const c = card(input);
  return target === "discord" ? discord(c) : slack(c);
}
