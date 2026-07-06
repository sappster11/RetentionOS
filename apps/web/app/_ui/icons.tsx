// Inline SVG icon set. No icon-library dependency (keeps the bundle light and avoids the
// Artifact-style CSP concerns) — each icon is a small stroke-based SVG that inherits
// `currentColor`. `Icon` renders a field-type glyph; the named exports are chrome icons.
import type { FieldType } from '@retentionos/engine'
import type { CSSProperties } from 'react'

function Svg({ children, size = 15, style }: { children: React.ReactNode; size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

// --- Field-type icons -------------------------------------------------------
const FIELD_ICONS: Record<FieldType, React.ReactNode> = {
  text: (
    <>
      <path d="M4 7V5h16v2" />
      <path d="M9 19h6" />
      <path d="M12 5v14" />
    </>
  ),
  long_text: (
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="10" x2="20" y2="10" />
      <line x1="4" y1="14" x2="20" y2="14" />
      <line x1="4" y1="18" x2="14" y2="18" />
    </>
  ),
  single_select: (
    <>
      <circle cx="12" cy="12" r="8" />
      <polyline points="9 11 12 14 15 11" />
    </>
  ),
  multi_select: (
    <>
      <line x1="8" y1="7" x2="20" y2="7" />
      <line x1="8" y1="12" x2="20" y2="12" />
      <line x1="8" y1="17" x2="20" y2="17" />
      <circle cx="4" cy="7" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="17" r="1" />
    </>
  ),
  number: (
    <>
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" />
      <line x1="16" y1="3" x2="14" y2="21" />
    </>
  ),
  currency: (
    <>
      <line x1="12" y1="3" x2="12" y2="21" />
      <path d="M16 7c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.8 3 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3" />
    </>
  ),
  checkbox: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <polyline points="8 12 11 15 16 9" />
    </>
  ),
  date: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="8" y1="3" x2="8" y2="6" />
      <line x1="16" y1="3" x2="16" y2="6" />
    </>
  ),
  datetime: (
    <>
      <circle cx="12" cy="12" r="8" />
      <polyline points="12 8 12 12 15 14" />
    </>
  ),
  url: (
    <>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <polyline points="3 7 12 13 21 7" />
    </>
  ),
  attachment: (
    <>
      <path d="M21 12.5l-8.5 8.5a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />
    </>
  ),
  linked_record: (
    <>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </>
  ),
  lookup: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </>
  ),
  rollup: (
    <>
      <path d="M4 5h16" />
      <path d="M4 5l6 7-6 7h16" />
    </>
  ),
  autonumber: (
    <>
      <path d="M4 9h4M4 15h4" />
      <path d="M9 4l-2 16M17 4l-2 16" />
    </>
  ),
  created_time: (
    <>
      <circle cx="12" cy="12" r="8" />
      <polyline points="12 8 12 12 15 14" />
    </>
  ),
  last_modified_time: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <polyline points="3 3 3 8 8 8" />
    </>
  ),
  percent: (
    <>
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </>
  ),
  formula: (
    <>
      <path d="M18 4H9a3 3 0 0 0-3 3v13" />
      <line x1="4" y1="11" x2="10" y2="11" />
      <line x1="14" y1="9" x2="19" y2="19" />
      <line x1="19" y1="9" x2="14" y2="19" />
    </>
  ),
}

export function FieldIcon({ type, size = 14, style }: { type: FieldType; size?: number; style?: CSSProperties }) {
  return (
    <Svg size={size} style={style}>
      {FIELD_ICONS[type]}
    </Svg>
  )
}

// --- Chrome / toolbar icons -------------------------------------------------
export const GridIcon = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </Svg>
)

export const EyeOffIcon = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M17.94 17.94A10 10 0 0 1 12 20C5 20 1 12 1 12a18 18 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </Svg>
)

export const FilterIcon = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </Svg>
)

export const SortIcon = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <line x1="4" y1="7" x2="14" y2="7" />
    <line x1="4" y1="12" x2="11" y2="12" />
    <line x1="4" y1="17" x2="8" y2="17" />
    <polyline points="16 15 19 18 22 15" />
    <line x1="19" y1="6" x2="19" y2="18" />
  </Svg>
)

export const GroupIcon = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <rect x="6" y="12" width="15" height="3" rx="1" />
    <rect x="6" y="17" width="15" height="3" rx="1" />
  </Svg>
)

export const ColorIcon = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="13.5" cy="6.5" r="2.5" />
    <circle cx="17.5" cy="10.5" r="2.5" />
    <circle cx="8.5" cy="7.5" r="2.5" />
    <circle cx="6.5" cy="12.5" r="2.5" />
    <path d="M12 2a10 10 0 1 0 0 20 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 1 2-4h1a4 4 0 0 0 4-4 10 10 0 0 0-9-8z" />
  </Svg>
)

export const RowHeightIcon = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </Svg>
)

export const SearchIcon = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </Svg>
)

export const PlusIcon = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
)

export const SidebarIcon = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="9" y1="4" x2="9" y2="20" />
  </Svg>
)

export const ChevronDownIcon = ({ size = 14 }: { size?: number }) => (
  <Svg size={size}>
    <polyline points="6 9 12 15 18 9" />
  </Svg>
)

export const TrashIcon = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </Svg>
)

export const CloseIcon = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="6" y1="18" x2="18" y2="6" />
  </Svg>
)

export const LinkIcon = ({ size = 13 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
  </Svg>
)

export const ExpandIcon = ({ size = 13 }: { size?: number }) => (
  <Svg size={size}>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </Svg>
)

export const HistoryIcon = ({ size = 14 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <polyline points="3 3 3 8 8 8" />
    <polyline points="12 8 12 12 14 14" />
  </Svg>
)

export const KanbanIcon = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3" y="4" width="5" height="16" rx="1" />
    <rect x="10" y="4" width="5" height="10" rx="1" />
    <rect x="17" y="4" width="4" height="13" rx="1" />
  </Svg>
)

export const FormIcon = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <line x1="8" y1="8" x2="16" y2="8" />
    <line x1="8" y1="12" x2="16" y2="12" />
    <line x1="8" y1="16" x2="12" y2="16" />
  </Svg>
)

export const CopyIcon = ({ size = 14 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
)

export const UserIcon = ({ size = 13 }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Svg>
)

export const BotIcon = ({ size = 13 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M12 8V4" />
    <circle cx="9" cy="14" r="1" />
    <circle cx="15" cy="14" r="1" />
  </Svg>
)
