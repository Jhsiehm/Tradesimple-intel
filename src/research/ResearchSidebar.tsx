import { useEffect, useRef, useState } from "react";
import type { AskApi } from "../ask/useAsk";
import type { AgentContext } from "../agent/context";
import { ScheduledTaskList } from "../tasks/ScheduledTasks";
import { useTasks } from "../tasks/useTasks";
import { Icon, type IconName } from "../ui/icons/Icon";
import { ResearchRunContext } from "./ResearchRunContext";
import { ResearchSavedConversations } from "./ResearchSavedConversations";
import "./sidebar.css";
export type ResearchTool =
  | "experiments"
  | "data"
  | "convergence"
  | "notebooks"
  | "guided"
  | "contractEvidence"
  | "policy"
  | "memory"
  | "stress"
  | "eventStudies"
  | "paper";
export type Registry = {
  asOf: string;
  experiments: { id: string }[];
  datasets: { id: string }[];
  notebooks: { id: string; status?: string }[];
  plans: { id: string; evaluated?: boolean }[];
};
const groups: { title: string; items: { id: ResearchTool; title: string; icon: IconName }[] }[] = [
  {
    title: "Evidence",
    items: [
      { id: "data", title: "Data Hub", icon: "feed" },
      { id: "contractEvidence", title: "Contract evidence", icon: "contracts" },
    ],
  },
  {
    title: "Experimentation",
    items: [
      { id: "policy", title: "Policy research", icon: "congress" },
      { id: "guided", title: "Design an experiment", icon: "draw" },
      { id: "experiments", title: "Experiments", icon: "backtest" },
      { id: "convergence", title: "Convergence", icon: "arc" },
      { id: "eventStudies", title: "Event studies", icon: "timeline" },
      { id: "stress", title: "Stress tests", icon: "filter" },
      { id: "paper", title: "Paper trading", icon: "backtest" },
    ],
  },
  {
    title: "Knowledge",
    items: [
      { id: "notebooks", title: "Notebooks", icon: "dossier" },
      { id: "memory", title: "Research memory", icon: "research" },
    ],
  },
];
export function useResearchSidebar() {
  const [desktopOpen, setDesktopOpen] = useState(() => {
    try {
      return localStorage.getItem("intel:research-sidebar") !== "closed";
    } catch {
      return true;
    }
  });
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 760px)").matches),
    [mobileOpen, setMobileOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const change = () => {
      setMobile(media.matches);
      setMobileOpen(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const setOpen = (value: boolean) => {
    if (mobile) setMobileOpen(value);
    else {
      setDesktopOpen(value);
      try {
        localStorage.setItem("intel:research-sidebar", value ? "open" : "closed");
      } catch {
        /* Layout still works without browser storage. */
      }
    }
  };
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  return {
    open: mobile ? mobileOpen : desktopOpen,
    mobile,
    trigger,
    toggle: () => setOpen(!(mobile ? mobileOpen : desktopOpen)),
    close,
    afterSelection: () => {
      if (mobile) close();
    },
  };
}
export function ResearchSidebar({
  ask,
  context,
  catalog,
  error,
  refreshing,
  onRefresh,
  onTool,
  layout,
}: {
  ask: AskApi;
  context: AgentContext;
  catalog: Registry | null;
  error: string;
  refreshing: boolean;
  onRefresh: () => void;
  onTool: (tool: ResearchTool) => void;
  layout: ReturnType<typeof useResearchSidebar>;
}) {
  const { res } = useTasks(true),
    closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (layout.mobile && layout.open) closeRef.current?.focus();
  }, [layout.mobile, layout.open]);
  const badge = (id: ResearchTool) =>
    catalog
      ? (
          {
            experiments: catalog.experiments.length,
            data: catalog.datasets.length,
            notebooks: catalog.notebooks.length,
            convergence: catalog.plans.length,
          } as Partial<Record<ResearchTool, number>>
        )[id]
      : undefined;
  const tools = (items: (typeof groups)[number]["items"]) =>
    items.map((tool) => (
      <button
        key={tool.id}
        data-tool={tool.id}
        onClick={() => {
          onTool(tool.id);
          layout.afterSelection();
        }}
      >
        <Icon name={tool.icon} size={15} />
        <span>{tool.title}</span>
        {badge(tool.id) !== undefined && (
          <small aria-label={`${badge(tool.id)} recent records`}>{badge(tool.id)}</small>
        )}
      </button>
    ));
  return (
    <aside
      id="research-workspace-sidebar"
      className="research-sidebar"
      hidden={!layout.open}
      aria-label="Research workspace"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          layout.close();
        }
      }}
    >
      <div className="research-sidebar-title">
        <Icon name="research" size={20} />
        <strong>Research workspace</strong>
        <button
          ref={closeRef}
          className="research-library-toggle"
          onClick={layout.close}
          aria-label="Collapse research sidebar"
          title="Collapse sidebar"
        >
          <Icon name="collapse" size={16} />
        </button>
      </div>
      <button
        className="research-new"
        onClick={() => {
          ask.newChat();
          layout.afterSelection();
        }}
        disabled={ask.busy}
      >
        <Icon name="draw" size={15} />
        New conversation
      </button>
      <ResearchRunContext ask={ask} context={context} />
      <ResearchSavedConversations ask={ask} afterSelection={layout.afterSelection} />
      <nav aria-label="Research tools">
        {groups.map((group) =>
          group.title === "Evidence" ? (
            <section className="research-nav-group" key={group.title}>
              <h2>{group.title}</h2>
              {tools(group.items)}
            </section>
          ) : (
            <details className="research-nav-group" key={group.title}>
              <summary>
                <span>{group.title}</span>
                <small>{group.items.length} tools</small>
              </summary>
              {tools(group.items)}
            </details>
          ),
        )}
      </nav>
      <div className="research-registry-status">
        <span>
          {error
            ? "Registry unavailable"
            : catalog
              ? `Registry read ${new Date(catalog.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Reading registry…"}
        </span>
        <button onClick={onRefresh} disabled={refreshing} aria-label="Refresh research registry">
          <Icon name="reset" size={13} />
        </button>
        <span className="research-registry-count-note">Counts: latest 20 per category.</span>
        {error && (
          <p role="alert">
            Could not refresh. {catalog ? "Showing the previous snapshot." : "Retry to load saved records."}
          </p>
        )}
      </div>
      <details className="research-scheduled">
        <summary>
          <span>Scheduled research</span>
          <span className="research-schedule-state">
            {!res
              ? "Checking…"
              : !res.ok
                ? "Unavailable"
                : res.control?.paused
                  ? "Paused"
                  : res.items.some((t) => t.running)
                    ? "Running"
                    : res.scheduler === "off"
                      ? "Automatic off"
                      : "Enabled"}
          </span>
        </summary>
        <ScheduledTaskList
          openTurns={(turns) => {
            ask.openTurns(turns);
            layout.afterSelection();
          }}
          res={res}
        />
      </details>
      <p className="research-local-note">
        <Icon name="dossier" size={12} />
        Conversations stay in this browser. Research records are stored on this server.
      </p>
    </aside>
  );
}
