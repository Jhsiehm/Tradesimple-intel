import { useEffect, useState } from "react";

const QUERY = "(max-width: 720px)";

/** Phone layout: list + dossier only. The map and boards are never mounted, so MapLibre never downloads. */
export function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}
