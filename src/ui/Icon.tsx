// A small drawn icon set: 16px grid, 1.5px stroke, round joins.
const PATHS = {
  search: "M7 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11Zm4-1.5 3.5 3.5",
  trash: "M2.5 4h11M6 4V2.5h4V4m-6 0 .7 9.5h6.6L12 4M6.8 7v4m2.4-4v4",
  undo: "M5 3 2 6l3 3M2.5 6H10a3.5 3.5 0 0 1 0 7H7",
  copy: "M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3",
  link: "M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1",
  close: "M3.5 3.5l9 9m0-9-9 9",
  plus: "M8 2.5v11M2.5 8h11",
  folder: "M1.5 4.5v8h13v-7H8L6.5 3.5h-5z",
  warn: "M8 2 1.5 13.5h13L8 2Zm0 4.5v3.5m0 1.5v.5",
  command:
    "M5 5H3.5a1.5 1.5 0 1 1 1.5-1.5V5Zm0 0h6M5 5v6m6-6V3.5A1.5 1.5 0 1 1 12.5 5H11Zm0 0v6m0 0h1.5a1.5 1.5 0 1 1-1.5 1.5V11Zm0 0H5m0 0v1.5A1.5 1.5 0 1 1 3.5 11H5Z",
  sun: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0-9.5V3m0 10v1.5M1.5 8H3m10 0h1.5M3.4 3.4l1 1m7.2 7.2 1 1m0-9.2-1 1m-7.2 7.2-1 1",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Zm6.5 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  code: "M5.5 4.5 2 8l3.5 3.5m5-7L14 8l-3.5 3.5",
  open: "M9 2.5h4.5V7m0-4.5L7 9m4.5.5v4h-9v-9h4",
  block: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM3.4 12.6l9.2-9.2",
} as const;

type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
