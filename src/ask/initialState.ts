import type { AskStatus, SavedChat } from "./types";
import { loadChats } from "./chats";

export const OFF: AskStatus = {
  ok: false,
  configured: false,
  provider: "",
  model: "",
  missing: [],
  notice: "The API did not answer.",
  tools: [],
};

/** `#ask=<question>` is a share link: it opens the sheet and asks. */
export const hashQuestion = () => {
  if (!location.hash.startsWith("#ask=")) return "";
  try {
    return decodeURIComponent(location.hash.slice(5));
  } catch {
    return "";
  }
};

/** Restore only this browser's active saved conversation. */
export function loadActiveChat(): SavedChat | null {
  try {
    const id = localStorage.getItem("intel:research:active-chat");
    return loadChats().find((c) => c.id === id) || null;
  } catch {
    return null;
  }
}
