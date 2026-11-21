interface IconProps {
  name: IconName;
  className?: string;
}

export type IconName =
  | 'plus'
  | 'hourglass'
  | 'coin'
  | 'skull'
  | 'rifle'
  | 'crosshair'
  | 'bomb'
  | 'wrench'
  | 'pause'
  | 'play'
  | 'forward'
  | 'route'
  | 'camera'
  | 'close'
  | 'arrowUp'
  | 'bolt'
  | 'clock'
  | 'trophy'
  | 'crown'
  | 'lock'
  | 'check';

/** Inline SVG icon set (currentColor), no emoji. */
export function Icon({ name, className = 'h-5 w-5' }: IconProps) {
  const common = {
    viewBox: '0 0 24 24',
    className,
    'aria-hidden': true as const,
  };
  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'plus':
      return (
        <svg {...common}>
          <path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z" fill="currentColor" />
        </svg>
      );
    case 'hourglass':
      return (
        <svg {...common}>
          <path d="M6 2h12v5l-4.5 5 4.5 5v5H6v-5l4.5-5L6 7z" fill="currentColor" />
        </svg>
      );
    case 'coin':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill="#f5c518" stroke="#7a5a00" strokeWidth="2" />
          <circle cx="12" cy="12" r="6" fill="none" stroke="#b88a00" strokeWidth="2" />
        </svg>
      );
    case 'skull':
      return (
        <svg {...common}>
          <path
            fillRule="evenodd"
            fill="currentColor"
            d="M12 2a8 8 0 0 0-8 8c0 3 1.5 5 3 6v4h2.5v-2h1v2h3v-2h1v2H17v-4c1.5-1 3-3 3-6a8 8 0 0 0-8-8zM8.5 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"
          />
        </svg>
      );
    case 'rifle':
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M1 11h13l2-2h7v4h-5l-1.5 2H12l-1 5H7.5l1-5H1z"
          />
        </svg>
      );
    case 'crosshair':
      return (
        <svg {...common} {...stroke}>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 1v6M12 17v6M1 12h6M17 12h6" />
        </svg>
      );
    case 'bomb':
      return (
        <svg {...common}>
          <circle cx="10.5" cy="14" r="7.5" fill="currentColor" />
          <path d="M15 8l3-3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M19 1v4M17 3h4" stroke="#ffb020" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'wrench':
      return (
        <svg {...common} {...stroke}>
          <path d="M14.5 6.5a4 4 0 0 0 5 5L9 22l-4-4L15.5 7.5" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...common}>
          <rect x="5" y="4" width="5" height="16" rx="1" fill="currentColor" />
          <rect x="14" y="4" width="5" height="16" rx="1" fill="currentColor" />
        </svg>
      );
    case 'play':
      return (
        <svg {...common}>
          <path d="M6 3l15 9-15 9z" fill="currentColor" />
        </svg>
      );
    case 'forward':
      return (
        <svg {...common}>
          <path d="M2 4l10 8-10 8zM12 4l10 8-10 8z" fill="currentColor" />
        </svg>
      );
    case 'route':
      return (
        <svg {...common} {...stroke}>
          <circle cx="5" cy="19" r="2.2" />
          <circle cx="19" cy="5" r="2.2" />
          <path d="M5 16.8C5 9 19 15 19 7.2" />
        </svg>
      );
    case 'camera':
      return (
        <svg {...common} {...stroke}>
          <path d="M3 8h4l2-3h6l2 3h4v12H3z" />
          <circle cx="12" cy="13.5" r="3.5" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common} {...stroke}>
          <path d="M5 5l14 14M19 5L5 19" />
        </svg>
      );
    case 'arrowUp':
      return (
        <svg {...common}>
          <path d="M12 2l9 10h-5.5v10h-7V12H3z" fill="currentColor" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...common}>
          <path d="M13.5 1L4 14h6.5L9.5 23 20 9.5h-6.7z" fill="currentColor" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...common} {...stroke}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 6v6l4 2" />
        </svg>
      );
    case 'trophy':
      return (
        <svg {...common} {...stroke}>
          <path d="M7 3h10v6a5 5 0 0 1-10 0z" />
          <path d="M7 5H3v2a4 4 0 0 0 4 4M17 5h4v2a4 4 0 0 1-4 4M12 14v4M8 21h8" />
        </svg>
      );
    case 'crown':
      return (
        <svg {...common}>
          <path d="M3 18L2 7l5 4 5-7 5 7 5-4-1 11z" fill="currentColor" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12.5l5 5L20 6.5" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...common}>
          <rect x="5" y="10" width="14" height="11" rx="2" fill="currentColor" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2.4" />
        </svg>
      );
  }
}

/** Picks a tower icon from its id / category. */
export function towerIconName(id: string, category: string): IconName {
  if (id === 'sniper') return 'crosshair';
  if (id === 'mortar') return 'bomb';
  if (id === 'rifleman') return 'rifle';
  if (category === 'sniper') return 'crosshair';
  if (category === 'explosive') return 'bomb';
  if (category === 'support') return 'wrench';
  return 'rifle';
}
