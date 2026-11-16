export function IconServer() {
  return (
    <svg className="tree-svg" viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="2" width="12" height="5" rx="1" fill="#42A5F5" />
      <rect x="2" y="9" width="12" height="5" rx="1" fill="#1E88E5" />
      <circle cx="4.5" cy="4.5" r="0.9" fill="#E3F2FD" />
      <circle cx="4.5" cy="11.5" r="0.9" fill="#BBDEFB" />
    </svg>
  );
}

export {
  IconEngine,
  IconEngineMysql,
  IconEnginePostgres,
  IconEngineSqlite,
} from "./EngineIcons";

export function IconDatabase() {
  return (
    <svg className="tree-svg" viewBox="0 0 16 16" aria-hidden>
      <ellipse cx="8" cy="4" rx="5.5" ry="2.2" fill="#66BB6A" />
      <path d="M2.5 4v8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V4" fill="#43A047" />
      <ellipse cx="8" cy="4" rx="5.5" ry="2.2" fill="#81C784" />
    </svg>
  );
}

export function IconTables() {
  return (
    <svg className="tree-svg" viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1" fill="#29B6F6" />
      <rect x="2" y="3" width="12" height="3" fill="#0288D1" />
      <path d="M2 8h12M6 6v7M10 6v7" stroke="#E1F5FE" strokeWidth="1" />
    </svg>
  );
}

export function IconViews() {
  return (
    <svg className="tree-svg" viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1" fill="#7E57C2" />
      <path d="M3.5 8c1.8-2.5 7.2-2.5 9 0-1.8 2.5-7.2 2.5-9 0z" fill="#E1BEE7" />
      <circle cx="8" cy="8" r="1.4" fill="#4A148C" />
    </svg>
  );
}

export function IconFunctions() {
  return (
    <svg className="tree-svg" viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="2" fill="#FFA726" />
      <text x="8" y="11.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#FFF">
        ƒ
      </text>
    </svg>
  );
}

export function IconEvents() {
  return (
    <svg className="tree-svg" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="6" fill="#26A69A" />
      <path d="M8 4.5V8l2.5 1.5" stroke="#E0F2F1" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function IconQueries() {
  return (
    <svg className="tree-svg" viewBox="0 0 16 16" aria-hidden>
      <rect x="3" y="2" width="8" height="11" rx="1" fill="#90CAF9" />
      <path d="M10 10.5l3 1.5-3 1.5z" fill="#1E88E5" />
    </svg>
  );
}

export function IconBackups() {
  return (
    <svg className="tree-svg" viewBox="0 0 16 16" aria-hidden>
      <rect x="4" y="2" width="8" height="12" rx="1" fill="#78909C" />
      <rect x="5.5" y="4" width="5" height="4" rx="0.5" fill="#CFD8DC" />
      <circle cx="8" cy="11" r="1.3" fill="#B0BEC5" />
    </svg>
  );
}
