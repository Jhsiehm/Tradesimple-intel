import { Children, type ReactNode } from 'react';

/** Keep the live region stable; replay the visual cue only when its message changes. */
export function ActivityFeedback({ children, className = '' }: { children: ReactNode; className?: string }) {
  const working = className.split(/\s+/).includes('research-working');
  const messageKey = Children.toArray(children).map(child => typeof child === 'string' || typeof child === 'number' ? child : '').join('');
  return <p role="status" aria-atomic="true" className={`research-feedback ${className}`}>
    <span key={messageKey} className="research-feedback-content">
      <svg className="research-feedback-icon" aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        {working ? <circle cx="10" cy="10" r="7" strokeDasharray="33 11" /> : <><circle cx="10" cy="10" r="7" /><path d="M10 9v5M10 6v1" /></>}
      </svg>
      <span>{children}</span>
    </span>
  </p>;
}
