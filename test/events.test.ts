import assert from "node:assert/strict";
import { test } from "node:test";
import { eventReader, eventText } from "../src/shared/events.ts";

/** The events a page reads from `text` when it arrives cut at each byte offset in `cuts`. */
function readInChunks(text: string, cuts: number[]) {
  const bytes = new TextEncoder().encode(text);
  const read = eventReader();
  const ends = [...cuts, bytes.length];
  return ends.flatMap((end, i) => read(bytes.subarray(ends[i - 1] ?? 0, end)));
}

const offsetOf = (text: string, part: string) =>
  new TextEncoder().encode(text.split(part)[0]).length;

test("events the server writes reach the page whole, wherever the stream is cut", () => {
  const stream = `${eventText("unwatched", ["/home/zoé/app"])}: heartbeat\n\n${eventText("change", {})}`;
  const cuts = [
    // Inside a field name, inside the data, and between the two bytes of é.
    offsetOf(stream, "ent: unwatched"),
    offsetOf(stream, "home/zo"),
    offsetOf(stream, "é") + 1,
    // Inside the heartbeat comment.
    offsetOf(stream, "beat"),
  ];

  assert.deepEqual(readInChunks(stream, cuts), [
    { event: "unwatched", data: '["/home/zoé/app"]' },
    { event: "change", data: "{}" },
  ]);
});

test("an event with no data line is still read, with empty data", () => {
  assert.deepEqual(readInChunks("event: change\n\n", [7]), [{ event: "change", data: "" }]);
});

test("an event is not read until its blank line arrives", () => {
  const read = eventReader();
  const encode = (text: string) => new TextEncoder().encode(text);

  assert.deepEqual(read(encode("event: change\ndata: {}\n")), []);
  assert.deepEqual(read(encode("\n")), [{ event: "change", data: "{}" }]);
});
