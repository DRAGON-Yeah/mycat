import type { ToolbarAction } from "../stores/workspaceStore";

type Props = { id: ToolbarAction | "console"; size?: number };

export function ToolbarIcon({ id, size = 28 }: Props) {
  const s = size;
  switch (id) {
    case "connection":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden>
          <rect x="4" y="6" width="24" height="18" rx="2" fill="#4CAF50" />
          <rect x="7" y="9" width="18" height="3" rx="1" fill="#E8F5E9" />
          <rect x="7" y="14" width="12" height="2" rx="1" fill="#C8E6C9" />
          <rect x="7" y="18" width="10" height="2" rx="1" fill="#C8E6C9" />
          <circle cx="24" cy="22" r="5" fill="#FFC107" stroke="#FFF" strokeWidth="1.5" />
          <path d="M22.5 22h3M24 20.5v3" stroke="#5D4037" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "table":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden>
          <rect x="4" y="6" width="24" height="20" rx="2" fill="#29B6F6" />
          <rect x="4" y="6" width="24" height="5" fill="#0288D1" />
          <path d="M4 16h24M4 21h24M12 11v15M20 11v15" stroke="#E1F5FE" strokeWidth="1.2" />
        </svg>
      );
    case "view":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden>
          <rect x="5" y="7" width="22" height="16" rx="2" fill="#AB47BC" />
          <path d="M8 15c2.5-4 13.5-4 16 0-2.5 4-13.5 4-16 0z" fill="#E1BEE7" />
          <circle cx="16" cy="15" r="2.5" fill="#6A1B9A" />
        </svg>
      );
    case "function":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden>
          <rect x="5" y="5" width="22" height="22" rx="4" fill="#7E57C2" />
          <text x="16" y="22" textAnchor="middle" fontSize="16" fontWeight="700" fill="#FFF" fontFamily="Georgia, serif">
            ƒ
          </text>
        </svg>
      );
    case "query":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden>
          <rect x="4" y="5" width="20" height="22" rx="2" fill="#FFA726" />
          <rect x="7" y="9" width="14" height="2" rx="1" fill="#FFF3E0" />
          <rect x="7" y="14" width="11" height="2" rx="1" fill="#FFE0B2" />
          <rect x="7" y="19" width="13" height="2" rx="1" fill="#FFE0B2" />
          <circle cx="23" cy="23" r="6" fill="#42A5F5" stroke="#FFF" strokeWidth="1.5" />
          <circle cx="23" cy="23" r="2.5" fill="none" stroke="#FFF" strokeWidth="1.4" />
          <path d="M26.5 26.5l2 2" stroke="#FFF" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "backup":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden>
          <rect x="8" y="4" width="16" height="24" rx="2" fill="#78909C" />
          <rect x="11" y="8" width="10" height="8" rx="1" fill="#CFD8DC" />
          <circle cx="16" cy="22" r="3" fill="#90A4AE" />
          <path d="M22 18l6 3-6 3v-2h-5v-2h5v-2z" fill="#66BB6A" />
        </svg>
      );
    case "automation":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden>
          <circle cx="16" cy="16" r="10" fill="#26A69A" />
          <path d="M16 9v7l5 3" stroke="#E0F2F1" strokeWidth="2" strokeLinecap="round" fill="none" />
          <circle cx="16" cy="16" r="2" fill="#E0F2F1" />
        </svg>
      );
    case "model":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden>
          <rect x="4" y="8" width="10" height="7" rx="1.5" fill="#5C6BC0" />
          <rect x="18" y="8" width="10" height="7" rx="1.5" fill="#42A5F5" />
          <rect x="11" y="19" width="10" height="7" rx="1.5" fill="#26C6DA" />
          <path d="M9 15v2h3M23 15v2h-3M16 19v-2" stroke="#90A4AE" strokeWidth="1.5" />
        </svg>
      );
    case "bi":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden>
          <rect x="5" y="18" width="5" height="8" fill="#66BB6A" />
          <rect x="13" y="12" width="5" height="14" fill="#42A5F5" />
          <rect x="21" y="7" width="5" height="19" fill="#FFA726" />
          <path d="M6 16l7-6 7 3 6-8" stroke="#EF5350" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "console":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden>
          <rect x="3" y="6" width="26" height="20" rx="2" fill="#455A64" />
          <path d="M8 12l4 4-4 4M14 20h8" stroke="#80CBC4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      );
    default:
      return null;
  }
}
