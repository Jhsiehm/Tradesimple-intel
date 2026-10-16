import {hashOf} from '../research-store.mjs';
import {nyDate} from '../../../shared/dates.mjs';

export function verifyAttemptRow(row) {
  if (!row) return null;
  if (hashOf(row.body) !== row.body_hash) throw Error('Task execution checksum mismatch.');
  const a = JSON.parse(row.body);
  if (a.schemaVersion !== 1 || a.id !== row.id || a.taskId !== row.task_id ||
      a.task?.id !== a.taskId || a.day !== row.day || a.startedAt !== row.started_at ||
      a.pid !== row.pid || !Number.isSafeInteger(a.startedAt) || a.day !== nyDate(a.startedAt)) {
    throw Error('Task attempt identity or budget day mismatch.');
  }
  return a;
}

export function verifyCompletion(record, attempt) {
  if (!attempt || record.attemptId !== attempt.id || record.attemptHash !== hashOf(attempt)) {
    throw Error('Task completion attempt reference mismatch.');
  }
  if (!['finished', 'interrupted'].includes(record.status) || !Number.isSafeInteger(record.finishedAt)) {
    throw Error('Invalid task completion state.');
  }
  const run = record.run;
  if ((record.status === 'interrupted' && run !== null) || (run &&
      (run.taskId !== attempt.taskId || run.startedAt !== attempt.startedAt ||
       (run.meta?.attemptId != null && run.meta.attemptId !== attempt.id)))) {
    throw Error('Task completion result reference mismatch.');
  }
  return record;
}
