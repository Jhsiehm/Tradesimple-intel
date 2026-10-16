import { lazy, Suspense, useEffect, useState, type ComponentProps } from "react";
import { ErrorBoundary } from "../ui/ErrorBoundary";

const AskSheet = lazy(() => import("./AskSheet").then((m) => ({ default: m.AskSheet })));

/** Load on first use, then keep the sheet mounted so closing it preserves its draft and size. */
export function DeferredAskSheet(props: ComponentProps<typeof AskSheet>) {
  const [loaded, setLoaded] = useState(props.ask.open);
  useEffect(() => {
    if (props.ask.open) setLoaded(true);
  }, [props.ask.open]);
  if (!loaded && !props.ask.open) return null;
  return (
    <div hidden={!props.ask.open}>
      <ErrorBoundary name="Ask" resetKey={String(props.ask.open)}>
        <Suspense
          fallback={
            <p className="ask-loading" role="status">
              Loading Ask…
            </p>
          }
        >
          <AskSheet {...props} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
