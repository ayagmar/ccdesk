// The message posted to a Slack incoming webhook when a release is published: what changed in
// ccdesk, and what changed in Claude Code since the last release. Pure: `announce-release.ts`
// gathers the inputs and the Release workflow posts the result.

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

/** How many bullets each list shows before "and N more". */
const SHOWN = 8;
/** The longest bullet; Claude Code's run to several lines. */
const BULLET = 180;

/** Markdown links become their text, bold scopes become plain, and commit links are dropped. */
function plain(markdown: string): string {
  return markdown
    .replace(/\s*\(\[[0-9a-f]{7,}\]\([^)]*\)\)/g, "")
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

type SlackBlock =
  | { type: "header"; text: { type: "plain_text"; text: string } }
  | { type: "section"; text: { type: "mrkdwn"; text: string } }
  | { type: "context"; elements: [{ type: "mrkdwn"; text: string }] };

export interface SlackPayload {
  /** The notification text; the blocks are what the channel shows. */
  text: string;
  blocks: SlackBlock[];
  /** Off, so the GitHub links do not expand into previews in the channel. */
  unfurl_links: false;
  unfurl_media: false;
}

/** Slack's mrkdwn reads `&`, `<` and `>` as markup. */
function slackText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mrkdwn(text: string): SlackBlock {
  return { type: "section", text: { type: "mrkdwn", text } };
}

/** A bold heading and up to SHOWN bullets, with a link to the rest. */
function list(heading: string, bullets: string[], url: string): SlackBlock {
  const lines = [`*${heading}*`, ...bullets.slice(0, SHOWN).map((b) => `• ${slackText(b)}`)];
  const rest = bullets.length - SHOWN;
  if (rest > 0) lines.push(`<${url}|and ${rest} more>`);
  return mrkdwn(lines.join("\n"));
}

/** The Slack webhook payload for a release. */
export function announcement(input: Announcement): SlackPayload {
  const { version, releaseUrl, changelog, claudeCode } = input;
  const title = `ccdesk v${version}`;
  const moved = claudeCode.from !== claudeCode.to;
  const ours = releaseNotes(changelog, version);
  const theirs =
    moved && claudeCode.changelog
      ? claudeCodeNotes(claudeCode.changelog, claudeCode.from, claudeCode.to)
      : [];

  const tracks = moved
    ? `Tracks Claude Code *${claudeCode.to}*, up from ${claudeCode.from}.`
    : `Tracks Claude Code *${claudeCode.to}*.`;
  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: title } },
    mrkdwn(`${tracks}\n<${releaseUrl}|Release notes>`),
  ];
  if (ours.length === 0) blocks.push(mrkdwn("Nothing changed in ccdesk itself."));
  if (ours.length > 0) blocks.push(list("Changes in ccdesk", ours, releaseUrl));
  if (theirs.length > 0)
    blocks.push(list(`New in Claude Code since ${claudeCode.from}`, theirs, claudeCode.url));
  if (moved && theirs.length === 0)
    blocks.push(mrkdwn(`<${claudeCode.url}|What changed in Claude Code>`));
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `\`npx ccdesk@${version}\`` }],
  });

  return {
    text: `${title}: tracks Claude Code ${claudeCode.to}`,
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  };
}
