import { useEffect, useState } from "react";
import { onApiDown } from "../lib/api";
import "./apiBanner.css";

/** A small strip while a request waits for the API to come back (it restarts on every server save). Never blocks. */
export function ApiBanner() {
  const [down, setDown] = useState(false);
  useEffect(() => onApiDown(setDown), []);
  return (
    <p className="api-banner" role="status" aria-live="polite" hidden={!down}>
      {down ? <><i className="api-banner-dot" aria-hidden="true" />API restarting — retrying…</> : null}
    </p>
  );
}
