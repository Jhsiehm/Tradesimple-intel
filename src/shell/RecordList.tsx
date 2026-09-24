import type { ListItem } from "../types";

type Props = {
  items: ListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  empty: string;
};

export function RecordList({ items, selectedId, onSelect, empty }: Props) {
  if (!items.length) return <p className="empty">{empty}</p>;
  return (
    <>
      {items.map((item, index) => (
        <button
          key={item.id}
          className="row"
          aria-selected={item.id === selectedId}
          onClick={() => onSelect(item.id)}
        >
          <span className="idx">{String(index + 1).padStart(2, "0")}</span>
          <span>
            <span className={item.tone ? `title tone-${item.tone}` : "title"}>{item.title}</span>
            <small>{item.meta}</small>
          </span>
        </button>
      ))}
    </>
  );
}
