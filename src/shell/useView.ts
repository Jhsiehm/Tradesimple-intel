import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ALL_SCOPE, scopeOf, type IntelScope } from "../intel/useIntel";
import { applyView, START_VIEW, type View, type ViewPatch } from "./viewFor";

type Setters = { [K in keyof View as `set${Capitalize<K & string>}`]: (value: View[K]) => void };

/** Section, modes, layers, and selection in one state, so a navigation patch lands in one render. */
export function useView() {
  const [view, setView] = useState<View>(START_VIEW);
  /** Latest view for handlers registered in older renders (the window keydown listener). */
  const current = useRef(view);
  current.current = view;
  const setters = useMemo(() => {
    const one = <K extends keyof View>(key: K) => (value: View[K]) => setView((v) => (v[key] === value ? v : { ...v, [key]: value }));
    return {
      setSection: one("section"),
      setChamber: one("chamber"),
      setMode: one("mode"),
      setVoteView: one("voteView"),
      setMapLayer: one("mapLayer"),
      setDistrictLayer: one("districtLayer"),
      setMarketView: one("marketView"),
      setLayer: one("layer"),
      setNewsView: one("newsView"),
      setSelectedId: one("selectedId"),
      applyPatch: (patch: ViewPatch) => setView((v) => applyView(v, patch))
    } satisfies Setters & { applyPatch: unknown };
  }, []);
  return { view, current, ...setters };
}

/** A member or ticker dossier scopes the scrubber; closing it puts the scope back to all of Congress. */
export function useDossierScope(key: string, setScope: Dispatch<SetStateAction<IntelScope>>) {
  const last = useRef("");
  useEffect(() => {
    const prev = last.current;
    last.current = key;
    if (key) setScope(scopeOf(key));
    else if (prev) {
      const was = scopeOf(prev);
      setScope((s) => (s.kind === was.kind && s.id === was.id ? ALL_SCOPE : s));
    }
  }, [key, setScope]);
}
