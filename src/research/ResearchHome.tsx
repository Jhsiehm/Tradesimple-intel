import { ResearchSidebar, useResearchSidebar } from "./ResearchSidebar";
import { Icon } from "../ui/icons/Icon";
import { ResearchEmblem } from "./ResearchEmblem";
import { useCallback, useEffect, useState } from "react";
import type { AskApi } from "../ask/useAsk";
import { hasContext } from "../ask/useAsk";
import { contextLine, type AgentContext } from "../agent/context";
import { TurnView } from "../agent/AskSheet";
import { ModelPick } from "../ask/ModelPick";
import { SpendLine } from "../ask/Spend";
import { read, message } from "./api";
import { ResearchQuestionGuide } from "./ResearchQuestionGuide";
import { ResearchContextStarters } from "./ResearchContextStarters";
import { QUESTION_LIMIT } from "./questionDraft";
import "./home.css";
import "./question-entry.css";
type RecordSummary = { id: string; title?: string; name?: string; status?: string; evaluated?: boolean };
type Catalog = {
  asOf: string;
  coverage: string;
  tools: { name: string; label: string; description: string; parameters: { properties: Record<string, unknown> } }[];
  experiments: RecordSummary[];
  plans: RecordSummary[];
  datasets: RecordSummary[];
  notebooks: RecordSummary[];
};

function Methods() {
  return (
    <details className="research-methods">
      <summary>Methods, equations & evidence standards</summary>
      <div className="method-grid">
        <article>
          <h3>Retrieve, then substantiate</h3>
          <p>
            Lewis et al. (2020), retrieval-augmented generation. Retrieved evidence can inform generation; retrieval
            does not guarantee factuality. This terminal uses cited tool results, not a trained implementation of that
            paper.
          </p>
          <a href="https://arxiv.org/abs/2005.11401" target="_blank" rel="noreferrer">
            Read the paper ↗
          </a>
        </article>
        <article>
          <h3>Inspect actions and observations</h3>
          <p>
            Yao et al., ReAct (ICLR 2023). Tool actions and observations inform subsequent work. Here, inspect tool
            steps, sources, failures and results; animation reflects execution events, not hidden reasoning.
          </p>
          <a href="https://arxiv.org/abs/2210.03629" target="_blank" rel="noreferrer">
            Read the paper ↗
          </a>
        </article>
        <article>
          <h3>Repeated testing changes confidence</h3>
          <p>
            Bailey & López de Prado (2014), Deflated Sharpe Ratio. Selection among many trials can inflate reported
            performance. DSR is a reference, not a metric currently computed here.
          </p>
          <code>SR̂ = mean(r − rƒ) / sd(r − rƒ)</code>
          <p>
            r: periodic return; rƒ: matching risk-free return. Same sampling frequency; undefined at zero dispersion.
            This descriptive ratio alone is not evidence of predictive skill.
          </p>
          <a href="https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf" target="_blank" rel="noreferrer">
            Read the author’s paper ↗
          </a>
        </article>
        <article>
          <h3>What Convergence actually computes</h3>
          <code>ΔE = E(all sources) − E(without source)</code>
          <p>
            E is strategy return minus the same full-window SPY return. ΔE is a descriptive ablation difference, not
            causal attribution. A locked historical holdout can still have been inspected elsewhere. Available intervals
            use 2,000 seeded entry-week bootstrap draws. Inference is withheld for insufficient week blocks, invalid
            intervals or cross-week overlapping holdings; remaining diagnostics are exploratory and not multiple-testing
            corrected.
          </p>
        </article>
      </div>
    </details>
  );
}
export function ResearchHome({
  ask,
  context,
  onFollow,
  onTool,
}: {
  ask: AskApi;
  context: AgentContext;
  onFollow: (a: string) => void;
  onTool: (
    t:
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
      | "paper",
  ) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState("");
  const layout = useResearchSidebar(),
    [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setCatalog(await read<Catalog>("context"));
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const last = ask.turns.at(-1),
    active = last?.steps
      .slice()
      .reverse()
      .find((s) => s.state === "running");
  const submit = () => {
    if (!ask.busy && ask.status?.configured && ask.draft.trim()) void ask.run(ask.draft);
  };
  return (
    <section
      className="research-home"
      data-conversation={ask.turns.length > 0}
      data-sidebar-open={layout.open}
      onKeyDown={(event) => {
        if (layout.mobile && layout.open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          layout.close();
        }
      }}
    >
      <ResearchSidebar
        ask={ask}
        context={context}
        catalog={catalog}
        error={error}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        onTool={onTool}
        layout={layout}
      />
      {layout.mobile && layout.open && (
        <button className="research-sidebar-backdrop" aria-label="Close research sidebar" onClick={layout.close} />
      )}
      <main className="research-main" inert={layout.mobile && layout.open}>
        {error && (
          <p role="alert" className="bt-note warn">
            {error}
          </p>
        )}
        {ask.storageError && (
          <p role="alert" className="bt-note warn">
            {ask.storageError}
          </p>
        )}
        <header className="research-home-top">
          <button
            ref={layout.trigger}
            className="research-library-toggle"
            onClick={layout.toggle}
            aria-expanded={layout.open}
            aria-controls="research-workspace-sidebar"
            aria-label={layout.open ? "Hide research sidebar" : "Show research sidebar"}
          >
            <Icon name="panels" size={16} />
            <span>Workspace</span>
          </button>
          <span>{ask.turns.length ? "Conversation" : "New conversation"}</span>
          <button onClick={() => ask.show()}>Open in side panel</button>
        </header>
        <div className="research-chat-stage">
          {!ask.turns.length ? (
            <div className="research-hero">
              <ResearchEmblem />
              <h1>Research question</h1>
            </div>
          ) : (
            <div className="research-conversation" aria-label="Research conversation">
              {ask.turns.map((t) => (
                <TurnView key={t.id} turn={t} busy={ask.busy} ask={ask} prompts={[]} onFollow={onFollow} />
              ))}
            </div>
          )}
          {ask.busy && (
            <div className="research-execution" role="status">
              <ResearchEmblem active />
              <div>
                <strong>{active?.label || last?.phase || "Working"}</strong>
                <p>{active?.source || "Waiting for the next research step."}</p>
              </div>
            </div>
          )}
          <div className="research-composer">
            <label className="research-question-label" htmlFor="research-question">
              Your research question
            </label>
            <textarea
              id="research-question"
              aria-describedby={`research-question-help${ask.draft.length ? " research-question-length" : ""}`}
              value={ask.draft}
              maxLength={QUESTION_LIMIT}
              onChange={(e) => ask.setDraft(e.target.value)}
              placeholder="Ask about a company, explore a signal, or test an idea…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="research-composer-help">
              <p id="research-question-help">State your question, the evidence you need, and the outcome to measure.</p>
              {ask.draft.length > 0 && (
                <p id="research-question-length" className="research-question-length">
                  {ask.draft.length}/{QUESTION_LIMIT} characters
                </p>
              )}
            </div>
            <div className="research-composer-controls">
              <label>
                Sources
                <select
                  value={ask.session.sourcing || "platform"}
                  disabled={ask.busy}
                  onChange={(e) => ask.setSourcing(e.target.value)}
                >
                  <option value="platform">Platform feeds</option>
                  <option value="both">Platform + web</option>
                  <option value="web">Web only</option>
                </select>
              </label>
              <ModelPick ask={ask} busy={ask.busy} />
              {ask.busy ? (
                <button className="research-stop" onClick={ask.stop}>
                  Stop execution
                </button>
              ) : (
                <button
                  className="research-submit"
                  title="Ask question (Ctrl+Enter or Command+Enter)"
                  disabled={!ask.draft.trim() || !ask.status?.configured}
                  onClick={submit}
                >
                  Ask question
                </button>
              )}
            </div>
            <details className="research-options">
              <summary>Attachments & preferences</summary>
              <p>
                {hasContext(context) && !ask.detached
                  ? `Attached screen: ${contextLine(context)}`
                  : "No screen selection attached"}
                {hasContext(context) && (
                  <button onClick={() => ask.setDetached(!ask.detached)}>
                    {ask.detached ? "Attach screen" : "Detach screen"}
                  </button>
                )}
              </p>
              <div className="research-extra-options">
                <label>
                  Saved chat
                  <select value={ask.attachId} onChange={(e) => ask.setAttachId(e.target.value)}>
                    <option value="">None</option>
                    {ask.chats
                      .filter((c) => c.id !== ask.chatId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Style
                  <select value={ask.session.style || "terminal"} onChange={(e) => ask.setStyle(e.target.value)}>
                    <option value="terminal">Terminal</option>
                    <option value="professional">Professional</option>
                    <option value="simplified">Simplified</option>
                  </select>
                </label>
              </div>
              <SpendLine status={ask.status} />
            </details>
            {ask.status && !ask.status.configured && (
              <p className="research-provider-note" role="alert">
                AI execution unavailable: {ask.status.notice} Saved research and manual tools remain available.{" "}
                <button onClick={() => void ask.refreshStatus()}>Retry connection</button>
              </p>
            )}
            {ask.turns.length > 0 && (
              <button
                className="research-keep"
                onClick={() => {
                  setError(ask.keep() ? "" : "Browser could not save this chat.");
                }}
              >
                {ask.kept ? "Save conversation again" : "Keep conversation"}
              </button>
            )}
          </div>
          <ResearchQuestionGuide
            key={ask.chatId || ask.turns[0]?.id || "new"}
            records={catalog?.experiments || []}
            busy={ask.busy}
            draft={ask.draft}
            onDraft={ask.setDraft}
          />
          {!ask.turns.length && (
            <ResearchContextStarters
              chats={ask.chats}
              chatId={ask.chatId}
              notebooks={catalog?.notebooks || []}
              plans={catalog?.plans || []}
              onSelect={(question, chat) => {
                ask.setDraft(question);
                ask.setAttachId(chat);
                document.getElementById("research-question")?.focus();
              }}
            />
          )}
        </div>
        <details className="research-reference">
          <summary>Sources & research methods</summary>
          <details className="research-catalog">
            <summary>Data-layer variables · {catalog?.tools.length ?? "…"} registered tools</summary>
            <p>{catalog?.coverage || "Loading tool catalog…"}</p>
            <p>
              Catalog read: {catalog?.asOf || "pending"}. Tool registration is not proof of current feed coverage. Query
              results provide source, as-of and latency.
            </p>
            <input
              aria-label="Find data layer"
              placeholder="Find filings, weather, prices, satellite…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="method-grid">
              {catalog?.tools
                .filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(search.toLowerCase()))
                .map((t) => (
                  <article key={t.name}>
                    <h3>{t.label}</h3>
                    <p>{t.description}</p>
                    <small>
                      Inputs: {Object.keys(t.parameters.properties).join(", ") || "No parameters"} · retrieval required
                    </small>
                    <button
                      onClick={() =>
                        ask.setDraft(
                          `Use ${t.name} to investigate a question. Ask me for required inputs first. Report coverage, sources, timestamps and limitations before interpreting results.`,
                        )
                      }
                    >
                      Use this layer ↗
                    </button>
                  </article>
                ))}
            </div>
          </details>
          <Methods />
        </details>
      </main>
    </section>
  );
}
