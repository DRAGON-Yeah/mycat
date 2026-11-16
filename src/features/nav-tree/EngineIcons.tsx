import mysqlLogo from "../../assets/engines/mysql.svg";
import postgresLogo from "../../assets/engines/postgresql.svg";
import sqliteLogo from "../../assets/engines/sqlite.svg";

type EngineIconProps = { active?: boolean; large?: boolean };

function EngineBadge({
  active,
  large,
  src,
  alt,
}: EngineIconProps & { src: string; alt: string }) {
  const sizeClass = large ? "is-large" : "";
  return (
    <span
      className={`tree-engine-badge ${sizeClass} ${active ? "is-active" : ""}`}
      title={alt}
    >
      <img src={src} alt="" className="tree-engine-mark" draggable={false} />
    </span>
  );
}

export function IconEngineMysql({
  active = false,
  large = false,
}: EngineIconProps) {
  return (
    <EngineBadge
      active={active}
      large={large}
      src={mysqlLogo}
      alt="MySQL"
    />
  );
}

export function IconEnginePostgres({
  active = false,
  large = false,
}: EngineIconProps) {
  return (
    <EngineBadge
      active={active}
      large={large}
      src={postgresLogo}
      alt="PostgreSQL"
    />
  );
}

export function IconEngineSqlite({
  active = false,
  large = false,
}: EngineIconProps) {
  return (
    <EngineBadge
      active={active}
      large={large}
      src={sqliteLogo}
      alt="SQLite"
    />
  );
}

export function IconEngine({
  engine,
  active = false,
  large = false,
}: {
  engine: string;
  active?: boolean;
  large?: boolean;
}) {
  const e = String(engine || "").toLowerCase();
  if (e === "postgres" || e === "postgresql") {
    return <IconEnginePostgres active={active} large={large} />;
  }
  if (e === "sqlite") {
    return <IconEngineSqlite active={active} large={large} />;
  }
  return <IconEngineMysql active={active} large={large} />;
}
