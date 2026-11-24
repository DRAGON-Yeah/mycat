import { useRef, useState, type KeyboardEvent } from "react";
import { redisExecute, type RedisReply } from "./redisApi";

type Output = {
  id: number;
  command: string;
  reply?: RedisReply;
  error?: string;
};

function formatReply(reply: RedisReply): string {
  if (reply.kind === "array") {
    return JSON.stringify(reply.value, null, 2);
  }
  if (reply.kind === "nil") return "(nil)";
  return reply.text;
}

type Props = {
  connectionId: string;
  db: string;
};

export function RedisCommandConsole({ connectionId, db }: Props) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  async function run() {
    const command = input.trim();
    if (!command) {
      setError("命令不能为空");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const reply = await redisExecute({ connectionId, db, command });
      setOutputs((prev) => [
        ...prev,
        { id: Date.now(), command, reply },
      ]);
      setHistory((prev) => [...prev, command]);
      setHistoryIndex(-1);
      setInput("");
      window.setTimeout(() => {
        const node = outputRef.current;
        if (node) node.scrollTop = node.scrollHeight;
      }, 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setOutputs((prev) => [
        ...prev,
        { id: Date.now(), command, error: message },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void run();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const next =
        historyIndex < 0
          ? history.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setInput(history[next] ?? "");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex < 0) return;
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(-1);
        setInput("");
      } else {
        setHistoryIndex(next);
        setInput(history[next] ?? "");
      }
    }
  }

  return (
    <div className="redis-console">
      <div className="redis-console-head">
        <span>命令控制台</span>
        <span className="redis-console-hint">
          命令以当前连接权限执行；↑/↓ 浏览历史
        </span>
      </div>
      <div className="redis-console-output" ref={outputRef}>
        {outputs.length === 0 && (
          <div className="redis-empty">
            输入 Redis 命令，例如 <code>SET k v</code> 或 <code>HGETALL k</code>
          </div>
        )}
        {outputs.map((item) => (
          <div key={item.id} className="redis-console-entry">
            <div className="redis-console-cmd">
              <span className="redis-prompt">redis&gt;</span>
              <code>{item.command}</code>
            </div>
            {item.error ? (
              <div className="redis-cmd-error">{item.error}</div>
            ) : item.reply ? (
              <div
                className={`redis-console-reply ${
                  item.reply.kind === "error" ? "is-error" : ""
                }`}
              >
                <pre>{formatReply(item.reply)}</pre>
                {item.reply.truncated && (
                  <div className="redis-truncated">结果已截断</div>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {error && <div className="redis-error">{error}</div>}
      <div className="redis-console-input">
        <span className="redis-prompt">redis&gt;</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入命令后回车"
          spellCheck={false}
          disabled={busy}
        />
        <button type="button" disabled={busy} onClick={() => void run()}>
          执行
        </button>
      </div>
    </div>
  );
}
