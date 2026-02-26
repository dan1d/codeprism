import { useId } from "react";
import { cn } from "@/lib/utils";

interface PrismLogoProps {
  className?: string;
  /** Show the wordmark "codeprism" next to the mark */
  wordmark?: boolean;
  wordmarkClassName?: string;
}

export function PrismLogo({ className, wordmark, wordmarkClassName }: PrismLogoProps) {
  const uid = useId();
  const fillId = `prismFill-${uid}`;
  const glowId = `prismGlow-${uid}`;

  const mark = (
    <svg viewBox="0 0 36 36" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={fillId} x1="3" y1="30" x2="27" y2="2" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1f6feb" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#58a6ff" stopOpacity="0.32" />
        </linearGradient>
        <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Main triangle */}
      <polygon
        points="18,3 33,30 3,30"
        fill={`url(#${fillId})`}
        stroke="#58a6ff"
        strokeWidth="1.6"
        strokeLinejoin="round"
        filter={`url(#${glowId})`}
      />

      {/* Inner refraction line */}
      <line x1="18" y1="3" x2="9" y2="30" stroke="#58a6ff" strokeWidth="0.7" strokeOpacity="0.28" />

      {/* Spectrum dots at base — the "prism" dispersal */}
      <circle cx="5"  cy="30" r="1.6" fill="#f85149" />
      <circle cx="9"  cy="30" r="1.6" fill="#d29922" />
      <circle cx="13" cy="30" r="1.6" fill="#3fb950" />
      <circle cx="17" cy="30" r="1.6" fill="#58a6ff" />
      <circle cx="21" cy="30" r="1.6" fill="#a371f7" />
    </svg>
  );

  if (!wordmark) return mark;

  return (
    <div className="flex items-center gap-2.5">
      {mark}
      <span className={cn("font-bold tracking-tight text-[#e1e4e8]", wordmarkClassName)}>
        code<span className="text-[#58a6ff]">prism</span>
      </span>
    </div>
  );
}
