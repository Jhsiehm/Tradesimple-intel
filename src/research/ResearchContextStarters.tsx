import type { QuestionRecord } from "./questionDraft";

export function ResearchContextStarters({
  chats,
  chatId,
  notebooks,
  plans,
  onSelect,
}: {
  chats: { id: string; title: string }[];
  chatId: string | null;
  notebooks: QuestionRecord[];
  plans: (QuestionRecord & { evaluated?: boolean })[];
  onSelect: (question: string, chat: string) => void;
}) {
  const suggestions = [
    ...chats
      .filter((chat) => chat.id !== chatId)
      .slice(0, 2)
      .map((chat) => ({
        label: "Saved chat · browser-local",
        title: chat.title,
        question:
          "Review the attached saved chat. Identify unresolved hypotheses and propose a falsifiable follow-up. Separate prior assertions from newly retrieved evidence. Design only; do not execute calculations.",
        chat: chat.id,
      })),
    ...notebooks.slice(0, 1).map((notebook) => ({
      label: "Notebook · researcher-authored",
      title: notebook.title || notebook.id,
      question: `Read notebook ${notebook.id} with research_memory. Identify evidence gaps and propose a test. Treat its conclusions as hypotheses. Design only; do not execute calculations.`,
      chat: "",
    })),
    ...plans.slice(0, 1).map((plan) => ({
      label: `Convergence · ${plan.evaluated ? "holdout recorded" : "development only"}`,
      title: plan.title || plan.id,
      question: `Inspect convergence ${plan.id} using research_memory. Explain source ablations, exclusions and limits. Do not claim a new evaluation was run. Inspection only; do not rerun or start calculations.`,
      chat: "",
    })),
  ];
  if (!suggestions.length) return null;
  return (
    <details className="research-starters">
      <summary>Continue from saved context</summary>
      <div className="research-recommendations">
        {suggestions.map((suggestion) => (
          <button
            key={`${suggestion.label}-${suggestion.title}`}
            onClick={() => onSelect(suggestion.question, suggestion.chat)}
          >
            <strong>{suggestion.title}</strong>
            <small>{suggestion.label}</small>
          </button>
        ))}
      </div>
      <p>These drafts attach the selected context. Review the question before sending.</p>
    </details>
  );
}
