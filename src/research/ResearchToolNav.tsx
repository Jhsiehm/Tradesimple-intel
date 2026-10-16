import { useRef, useState } from "react";

const groups = [
  { title: "Get started", tools: [["guided", "Guided experiment", "Turn a question into a saved test."]] },
  {
    title: "Gather evidence",
    tools: [
      ["data", "Data Hub", "Import, check and version your data."],
      ["contractEvidence", "Contract evidence", "Inspect awards and their source records."],
      ["relationships", "Relationships", "Connect entities using dated evidence."],
    ],
  },
  {
    title: "Test an idea",
    tools: [
      ["experiments", "Experiments", "Review saved runs and replay results."],
      ["convergence", "Convergence", "Compare signals together and separately."],
      ["eventStudies", "Event studies", "Measure price behavior around events."],
      ["stress", "Stress tests", "Check sensitivity to changed assumptions."],
      ["paper", "Paper trading", "Review and record manual simulated fills."],
    ],
  },
  {
    title: "Keep and reuse findings",
    tools: [
      ["notebooks", "Notebooks", "Keep evidence, conclusions and follow-ups."],
      ["memory", "Memory", "Approve findings for future analyses."],
      ["pairs", "Paired research", "Compare answers with and without memory."],
      ["analyses", "Execution history", "Inspect what an analysis actually did."],
    ],
  },
] as const;
export type ResearchTool = (typeof groups)[number]["tools"][number][0];

export function ResearchToolNav({
  value,
  onSelect,
}: {
  value: ResearchTool;
  onSelect: (tool: ResearchTool | "home") => void;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const terms = query.trim().toLowerCase().split(/\s+/);
  const filtered = groups.map((group) => ({
    ...group,
    tools: group.tools.filter((tool) =>
      terms.every((term) => `${group.title} ${tool[1]} ${tool[2]}`.toLowerCase().includes(term)),
    ),
  }));
  const active = groups.flatMap((group) => [...group.tools]).find((tool) => tool[0] === value)!;
  const close = () => {
    if (disclosure.current) disclosure.current.open = false;
    setQuery("");
    trigger.current?.focus();
  };
  return (
    <nav className="research-tool-nav" aria-label="Research tools">
      <button onClick={() => onSelect("home")}>Research home</button>
      <details
        ref={disclosure}
        className="research-tool-picker"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <summary ref={trigger}>
          <span>
            <strong>{active[1]}</strong>
            <small>{active[2]}</small>
          </span>
          <span className="research-tool-switch">Change tool</span>
        </summary>
        <label className="research-tool-search">
          Find a tool
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by task, such as import or compare"
          />
        </label>
        <div className="research-tool-directory">
          {filtered
            .filter((group) => group.tools.length)
            .map((group) => (
              <section key={group.title}>
                <h3>{group.title}</h3>
                {group.tools.map(([id, title, description]) => (
                  <button
                    key={id}
                    aria-current={value === id ? "page" : undefined}
                    onClick={() => {
                      onSelect(id);
                      close();
                    }}
                  >
                    <strong>{title}</strong>
                    <span>{description}</span>
                  </button>
                ))}
              </section>
            ))}
        </div>
        {!filtered.some((group) => group.tools.length) && (
          <p role="status">No tools match “{query}”. Try a task such as data, replay or notebooks.</p>
        )}
      </details>
    </nav>
  );
}
