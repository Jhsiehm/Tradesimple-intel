import { useId } from "react";
import "./emblem.css";

/** The brand's offset lens and four rays, animated only during real execution. */
export function ResearchEmblem({ active = false, compact = false }: { active?: boolean; compact?: boolean }) {
  const id = useId();
  return (
    <svg
      className={`research-emblem${active ? " executing" : ""}${compact ? " research-emblem-compact" : ""}`}
      viewBox="0 0 640 640"
      role="img"
      aria-label={active ? "Research running" : "TradeSimple research emblem"}
    >
      <defs>
        <linearGradient id={`${id}-rays`} x1="265" y1="371" x2="647" y2="371" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fffbea" />
          <stop offset=".48" stopColor="#d5e6c5" />
          <stop offset="1" stopColor="#14866b" />
        </linearGradient>
      </defs>
      <g transform="translate(-45 -45)">
        <g className="research-emblem-lens" fill="#f9f0d4">
          <path d="M518 167C474 125 414 101 351 101C202 101 80 195 79 363L154 360C158 287 218 229 296 229C332 229 363 244 387 269Z" />
          <path d="M79 370C81 535 201 629 351 629C414 629 475 605 518 564L388 464C363 491 330 505 296 505C219 505 154 445 154 373Z" />
        </g>
        <g fill={`url(#${id}-rays)`}>
          <path className="research-emblem-ray ray-one" d="M265 367L583 191C602 211 617 235 625 251Z" />
          <path className="research-emblem-ray ray-two" d="M266 371L633 286C641 307 646 330 647 352Z" />
          <path className="research-emblem-ray ray-three" d="M267 376L647 385C646 409 640 433 632 455Z" />
          <path className="research-emblem-ray ray-four" d="M268 379L624 491C613 516 596 539 577 550Z" />
        </g>
      </g>
    </svg>
  );
}
