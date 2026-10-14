/**
 * The server-sent events `/api/events` pushes to the page, written by the server and read by the
 * page with fetch, since EventSource cannot send the token header.
 */

/** One event: its name and its data line. */
export interface StreamEvent {
  event: string;
  data: string;
}

/** The text of one event, with `data` as JSON on a single line. */
export function eventText(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * A reader of an event stream: given each chunk as it arrives, it returns the events the chunk
 * completes. A chunk can end anywhere, even inside a character, so text waits until its event's
 * blank line. A line that starts with a colon, such as the heartbeat, is a comment; an event with no
 * data line has empty data. Only the `event` and `data` fields are read, as the server sends no
 * others, and only one data line, as JSON never needs two.
 */
export function eventReader(): (chunk: Uint8Array) => StreamEvent[] {
  const decoder = new TextDecoder();
  let buffer = "";
  return (chunk) => {
    buffer += decoder.decode(chunk, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    return blocks.flatMap((block) => {
      const fields = new Map<string, string>();
      for (const line of block.split("\n")) {
        const colon = line.indexOf(":");
        if (colon === 0) continue;
        const value = colon < 0 ? "" : line.slice(colon + 1);
        fields.set(colon < 0 ? line : line.slice(0, colon), value.replace(/^ /, ""));
      }
      const event = fields.get("event");
      return event === undefined ? [] : [{ event, data: fields.get("data") ?? "" }];
    });
  };
}
