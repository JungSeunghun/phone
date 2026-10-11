export type ToolbarIconName =
  "settings" | "capture" | "record" | "stop" | "sound" | "muted" | "disconnect";
const paths: Record<ToolbarIconName, string> = {
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  capture: "M3 7h4l2-3h6l2 3h4v13H3ZM12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  record: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16",
  stop: "M6 6h12v12H6Z",
  sound: "M3 9h4l5-4v14l-5-4H3ZM16 8q4 4 0 8M19 5q7 7 0 14",
  muted: "M3 9h4l5-4v14l-5-4H3ZM16 9l6 6m0-6-6 6",
  disconnect: "M8 3v5m8-5v5M5 8h14v3a7 7 0 0 1-14 0ZM12 18v4",
};
export function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
