import { useId, type CSSProperties, type PointerEvent } from "react";
import brandMark from "../assets/tradesimple-mark.svg";
import "./brandHome.css";

// A short, fixed scatter keeps the light fine-grained and repeatable, with no idle loop.
const DUST = [
  [600, 238, 140, -76, 3.8, 0],
  [619, 306, 154, -32, 4.4, 100],
  [613, 343, 164, -12, 3.1, 220],
  [638, 350, 148, -7, 4.2, 50],
  [630, 397, 158, 16, 3.1, 160],
  [620, 440, 146, 35, 4.3, 280],
  [597, 498, 138, 62, 3.4, 80],
  [584, 525, 122, 76, 3.1, 200],
  [636, 315, 116, -26, 2.8, 320],
  [624, 426, 126, 34, 2.8, 360]
] as const;

function aim(event: PointerEvent<HTMLButtonElement>) {
  if (event.pointerType === "touch" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const button = event.currentTarget;
  const bounds = button.getBoundingClientRect();
  const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
  const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
  // Update only this small SVG; pointer movement never rerenders the dashboard.
  button.style.setProperty("--brand-x", `${x * 7}px`);
  button.style.setProperty("--brand-y", `${y * 7}px`);
  button.style.setProperty("--brand-angle", `${y * 1.5}deg`);
}

function settle(button: HTMLButtonElement) {
  button.style.removeProperty("--brand-x");
  button.style.removeProperty("--brand-y");
  button.style.removeProperty("--brand-angle");
}

export function BrandHome({ onHome }: { onHome: () => void }) {
  const id = useId();
  return (
    <button
      type="button"
      className="brand-home"
      aria-label="TradeSimple Intel home"
      title="Home · Today"
      onClick={onHome}
      onPointerMove={aim}
      onPointerLeave={(event) => settle(event.currentTarget)}
      onPointerCancel={(event) => settle(event.currentTarget)}
      onBlur={(event) => settle(event.currentTarget)}
    >
      <svg className="brand-mark" width="36" height="36" viewBox="0 0 640 640" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${id}-light`} x1="590" y1="371" x2="790" y2="371" gradientUnits="userSpaceOnUse">
            <stop stopColor="#b9e8c9" stopOpacity="0" /><stop offset="0.3" stopColor="#a1e3bf" stopOpacity="0.42" /><stop offset="1" stopColor="#67d9b2" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="brand-symbol">
          <g transform="translate(-45 -45)">
            <g className="brand-beams" fill={`url(#${id}-light)`}>
              <path d="M265 367L704 110Q730 143 742 177Z" />
              <path d="M266 371L768 260Q773 281 776 302Z" />
              <path d="M267 376L776 400Q773 426 767 448Z" />
              <path d="M268 379L742 564Q729 594 704 617Z" />
            </g>
          </g>
          <image href={brandMark} width="640" height="640" />
          <g transform="translate(-45 -45)">
            <g className="brand-dust" fill="#ecf5d9">
              {DUST.map(([x, y, dx, dy, radius, delay], index) => (
                <circle key={index} className="brand-grain" cx={x} cy={y} r={radius} style={{
                  "--dust-x": `${dx}px`, "--dust-y": `${dy}px`, "--dust-delay": `${delay}ms`
                } as CSSProperties} />
              ))}
            </g>
          </g>
        </g>
      </svg>
    </button>
  );
}
