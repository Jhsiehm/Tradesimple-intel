import { useEffect, useState } from "react";
import { DEMO } from "../lib/api";

/** "Sign out" in the top bar, only on a hosted copy with sign-in on (GET /api/session says `auth`). A plain form post. */
export function SignOut() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (DEMO) return;
    let cancel = false;
    fetch("/api/session", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { auth?: boolean; signedIn?: boolean } | null) => { if (!cancel) setShow(Boolean(s?.auth && s.signedIn)); })
      .catch(() => {});
    return () => { cancel = true; };
  }, []);
  if (!show) return null;
  return (
    <form method="post" action="/logout" className="signout">
      <button type="submit" className="ghost signout-btn" title="Sign out of this browser">Sign out</button>
    </form>
  );
}
