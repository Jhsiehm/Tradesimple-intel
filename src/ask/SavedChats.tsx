import { useEffect, useRef, useState } from "react";
import { when } from "../lib/format";
import { Icon } from "../ui/icons/Icon";
import { filterChats, orderChats } from "./chats";
import type { AskApi } from "./useAsk";
import "./saved.css";

/** Past this many kept chats the list gets a filter box. */
const SEARCH_AT = 6;
const UNDO_MS = 8_000;

/**
 * Kept chats: pinned first, then most recent. Each row opens the chat; the row tools pin it, rename it in place
 * (Enter saves, Esc cancels, an empty name goes back to the automatic title), or delete it with an Undo.
 */
export function SavedChats({ ask }: { ask: AskApi }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const { deleted, dropUndo } = ask;

  useEffect(() => { if (editing) field.current?.select(); }, [editing]);
  useEffect(() => {
    if (!deleted) return;
    const timer = window.setTimeout(dropUndo, UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [deleted, dropUndo]);

  const list = filterChats(orderChats(ask.chats), query);
  const save = (cid: string) => { ask.rename(cid, name); setEditing(null); };

  return (
    <>
      <div className="ask-saved-head">
        <h2>Saved</h2>
        {ask.chats.length > SEARCH_AT ? (
          <input className="ask-saved-find" type="search" value={query} placeholder="Filter" aria-label="Filter saved chats" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        ) : null}
      </div>
      {deleted ? (
        <p className="ask-undo" role="status">
          Deleted “{deleted.chat.title}”.
          <button type="button" className="link" onClick={ask.undoForget}>Undo</button>
        </p>
      ) : null}
      {list.length ? (
        <ul>
          {list.map((c) => (
            <li key={c.id} className="ask-saved-row" data-pinned={c.pinned || undefined}>
              {editing === c.id ? (
                <input
                  ref={field}
                  className="ask-saved-name"
                  value={name}
                  maxLength={80}
                  aria-label="Chat name"
                  spellCheck={false}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => save(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); save(c.id); }
                    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(null); }
                  }}
                />
              ) : (
                <button type="button" className="ask-saved-open" aria-current={c.id === ask.chatId ? "true" : undefined} title={c.turns[0]?.question} onClick={() => ask.openSaved(c.id)} onDoubleClick={() => { setName(c.title); setEditing(c.id); }}>
                  <b>{c.pinned ? <Icon name="pin" size={11} className="ask-saved-pin" /> : null}{c.title}</b>
                  <time dateTime={c.updated || undefined}>{when(c.updated)}</time>
                </button>
              )}
              <span className="ask-saved-tools">
                <button type="button" aria-pressed={Boolean(c.pinned)} aria-label={c.pinned ? `Unpin ${c.title}` : `Pin ${c.title}`} title={c.pinned ? "Unpin" : "Pin to the top"} onClick={() => ask.pin(c.id, !c.pinned)}><Icon name="pin" size={12} /></button>
                <button type="button" aria-label={`Rename ${c.title}`} title="Rename" onClick={() => { setName(c.title); setEditing(c.id); }}><Icon name="draw" size={12} /></button>
                <button type="button" aria-label={`Delete ${c.title}`} title="Delete (Undo for a few seconds)" onClick={() => { if (editing === c.id) setEditing(null); ask.forget(c.id); }}><Icon name="trash" size={12} /></button>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="ask-note">{ask.chats.length ? "No saved chat matches." : "None kept yet."}</p>}
    </>
  );
}
