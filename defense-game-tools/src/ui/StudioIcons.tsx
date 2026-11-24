import type { SVGProps } from 'react';

export interface StudioIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
}

function SvgBase({ size = 15, className = '', children, ...rest }: StudioIconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconSelectCursor(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M5 3l14 7-6 2-3 7-5-16z" />
    </SvgBase>
  );
}

export function IconMoveAxes(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M12 2v20M2 12h20" />
      <path d="M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3" />
    </SvgBase>
  );
}

export function IconScaleBox(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M15 3h6v6M9 21H3v-6" />
      <path d="M21 3l-7 7M3 21l7-7" />
      <rect x="8" y="8" width="8" height="8" rx="1" strokeDasharray="2 2" />
    </SvgBase>
  );
}

export function IconRotateCw(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </SvgBase>
  );
}

export function IconCubePart(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M12 2l9 5v10l-9 5-9-5V7l9-5z" />
      <path d="M12 22V12M21 7l-9 5-9-5" />
    </SvgBase>
  );
}

export function IconWaypointPin(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M12 21s-6-5.33-6-10a6 6 0 1 1 12 0c0 4.67-6 10-6 10z" />
      <circle cx="12" cy="11" r="2" />
    </SvgBase>
  );
}

export function IconRooftopPad(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <rect x="3" y="4" width="18" height="6" rx="1" />
      <path d="M6 10v10M18 10v10M6 15h12" />
    </SvgBase>
  );
}

export function IconImportModel(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M12 3v12m0 0l-4-4m4 4l4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </SvgBase>
  );
}

export function IconEyeLos(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </SvgBase>
  );
}

export function IconLock(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </SvgBase>
  );
}

export function IconCpuDsa(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
      <path d="M10 10h4v4h-4z" />
    </SvgBase>
  );
}

export function IconGrid(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </SvgBase>
  );
}

export function IconUndo(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </SvgBase>
  );
}

export function IconRedo(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </SvgBase>
  );
}

export function IconDownload(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M12 4v11m0 0l-4-4m4 4l4-4" />
      <path d="M5 19h14" />
    </SvgBase>
  );
}

export function IconSave(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </SvgBase>
  );
}

export function IconWorkspaceGlobe(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 9h16.8M3.6 15h16.8M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18" />
    </SvgBase>
  );
}

export function IconFolder(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </SvgBase>
  );
}

export function IconChevronDown(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M6 9l6 6 6-6" />
    </SvgBase>
  );
}

export function IconChevronRight(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M9 6l6 6-6 6" />
    </SvgBase>
  );
}

export function IconMeshModel(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z" />
      <path d="M12 22V12M20 6.5l-8 5.5-8-5.5M4 17.5l8-5.5 8 5.5" />
    </SvgBase>
  );
}

export function IconNodeDot({
  colorClass = 'bg-sky-400',
  className = '',
}: {
  colorClass?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${colorClass} ${className}`}
      aria-hidden="true"
    />
  );
}

export function IconMapDoc(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z" />
      <path d="M9 4v14M15 6v14" />
    </SvgBase>
  );
}

export function IconTrash(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M3 6h18M8 6V4h8v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" />
    </SvgBase>
  );
}

export function IconClose(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M18 6L6 18M6 6l12 12" />
    </SvgBase>
  );
}

export function IconCheck(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M20 6L9 17l-5-5" />
    </SvgBase>
  );
}

export function IconPlus(props: StudioIconProps) {
  return (
    <SvgBase {...props}>
      <path d="M12 5v14M5 12h14" />
    </SvgBase>
  );
}
