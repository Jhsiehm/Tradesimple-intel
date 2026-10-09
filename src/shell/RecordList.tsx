import type { ListItem } from "../types";
import { Icon, type IconName } from "../ui/icons/Icon";

type Props = {
  /** `icon` and `tint` mark a row's kind (relationship map); other lists leave them off. */
  items: (ListItem & { icon?: IconName; tint?: string })[];
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
          style={item.tint ? { borderLeftColor: item.id === selectedId ? undefined : item.tint } : undefined}
        >
          <span className="idx">{item.icon ? <span style={{ color: item.tint }}><Icon name={item.icon} /></span> : String(index + 1).padStart(2, "0")}</span>
          <span>
            <span className={item.tone ? `title tone-${item.tone}` : "title"}>{item.title}</span>
            <small>{item.meta}</small>
          </span>
        </button>
      ))}
    </>
  );
}
