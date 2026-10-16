export type AnalysisEvent = { sequence: number; at: string; kind: string; data: Record<string, unknown> };
export type Analysis = { id: string; createdAt: string; status: string; headHash: string; events: AnalysisEvent[] };
export type AnalysisSummary = { id: string; createdAt: string; status: string; question: string; mode: string; snapshotId: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';

/** Presentation only: never interprets missing completion as success or regenerates an answer. */
export function describeAnalysis(analysis: Analysis) {
  const start = analysis.events.find(event => event.kind === 'started')?.data || {};
  const memory = object(start.memory), snapshot = object(start.snapshot);
  let answer = '', error = '';
  for (const event of analysis.events) {
    if (event.kind === 'model_output') error = text(event.data.error);
    if (event.kind !== 'event') continue;
    const data = event.data;
    if (data.type === 'step_progress' && data.reset === true) answer = '';
    if (data.type === 'token') answer += text(data.delta);
    if ((data.type === 'done' || data.type === 'error') && typeof data.answer === 'string') answer = data.answer;
    if (data.type === 'done') error = '';
    if (data.type === 'error') error = text(data.error) || error;
  }
  return {
    question: text(object(start.request).question), mode: text(memory.mode), snapshotId: text(memory.snapshotId),
    knownAt: text(snapshot.knownAt), provider: text(start.provider), model: text(start.model), answer, error,
    modelCalls: analysis.events.filter(event => event.kind === 'model_input').length,
    toolCalls: analysis.events.filter(event => event.kind === 'tool_input').length,
    records: Array.isArray(snapshot.records) ? snapshot.records.map(record => {
      const notebook = object(object(record).notebook);
      return { title: text(notebook.title), revision: notebook.revision, conclusion: text(notebook.conclusion) };
    }) : [],
  };
}
export function analysisEventLabel(event: AnalysisEvent) {
  const labels: Record<string, string> = { started: 'Execution started', model_input: 'Model request', model_output: 'Model response', tool_input: 'Tool request', tool_output: 'Tool result', tool_error: 'Tool failed', event: 'Stream event', finished: 'Execution finished' };
  const detail = event.kind.startsWith('tool_') ? text(event.data.name) : event.kind === 'event' ? text(event.data.type) : event.kind === 'finished' ? text(event.data.status) : '';
  return `${labels[event.kind] || event.kind}${detail ? ` · ${detail}` : ''}`;
}
