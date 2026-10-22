import { useState } from "react";
import type { AskApi } from "../ask/useAsk";
import { SavedChats } from "../ask/SavedChats";

const PREVIEW_COUNT = 3;

export function ResearchSavedConversations({ ask, afterSelection }: { ask: AskApi; afterSelection: () => void }) {
  const [all, setAll] = useState(false),
    more = ask.chats.length > PREVIEW_COUNT;
  return (
    <section className="research-saved" aria-label="Saved conversations">
      <SavedChats
        displayLimit={all ? undefined : PREVIEW_COUNT}
        ask={{
          ...ask,
          openSaved: (id) => {
            ask.openSaved(id);
            afterSelection();
          },
        }}
      />
      {more && (
        <button className="research-show-saved" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show recent conversations" : `Show all ${ask.chats.length} saved conversations`}
        </button>
      )}
    </section>
  );
}
