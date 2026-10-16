/** Counts are returned by validation; the bar visualizes rows, never task progress. */
export function ValidationSummary({
  received,
  valid,
  rejected,
  missingSourceUrls,
}: {
  received: number;
  valid: number;
  rejected: number;
  missingSourceUrls: number;
}) {
  return (
    <div className="research-validation research-result">
      <div className="research-validation-bar" aria-hidden="true">
        <span style={{ width: `${received ? (valid / received) * 100 : 0}%` }} />
        <span style={{ width: `${received ? (rejected / received) * 100 : 0}%` }} />
      </div>
      <dl>
        <div>
          <dt>Rows checked</dt>
          <dd>{received.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Valid</dt>
          <dd>{valid.toLocaleString()}</dd>
        </div>
        <div data-warning={rejected > 0}>
          <dt>Rejected</dt>
          <dd>{rejected.toLocaleString()}</dd>
        </div>
        <div data-warning={missingSourceUrls > 0}>
          <dt>Without source URLs</dt>
          <dd>{missingSourceUrls.toLocaleString()}</dd>
        </div>
      </dl>
    </div>
  );
}
