import { useEffect, useState } from "react";

/** Always-visible label for the frozen demo so nobody mistakes it for live data. */
export function DemoChip() {
  const [taken, setTaken] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}snapshot/manifest.json`)
      .then((r) => r.json())
      .then((m: { takenAt?: string }) => setTaken(m.takenAt || null))
      .catch(() => setTaken(null));
  }, []);
  return (
    <span
      className="demo-chip"
      title={`Not live. Static snapshot of the live API taken ${taken ? `${taken.slice(0, 16).replace("T", " ")} UTC` : "—"}. Every feed shows the as-of time from when the snapshot was taken. Clone the repo and add your own keys for live data.`}
    >
      DEMO · {taken ? taken.slice(0, 10) : "—"}
    </span>
  );
}
