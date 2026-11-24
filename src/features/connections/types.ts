export type EngineType = "mysql" | "postgres" | "sqlite" | "redis";

export type ConnectionDto = {
  id: string;
  name: string;
  engine: EngineType | string;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  user?: string | null;
  sslMode: string;
  sslTrust: boolean;
  sshEnabled: boolean;
  sshHost?: string | null;
  sshPort?: number | null;
  sshUser?: string | null;
  color?: string | null;
  starred: boolean;
  groupName?: string | null;
  hidden: boolean;
  secretRef?: string | null;
  createdAt: string;
  updatedAt: string;
  hasPassword: boolean;
};

export type UpsertConnectionInput = {
  id?: string;
  name: string;
  engine: EngineType;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  sslMode?: string;
  sslTrust?: boolean;
  sshEnabled?: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshPassword?: string;
  color?: string;
  starred?: boolean;
  groupName?: string;
  hidden?: boolean;
};
