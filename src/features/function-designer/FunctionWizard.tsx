import { useState } from "react";
import type { RoutineType } from "../object-list/routineMeta";
import type { WizardParam } from "./routineDdl";

const DATA_TYPES = [
  "INT",
  "BIGINT",
  "SMALLINT",
  "TINYINT",
  "VARCHAR",
  "CHAR",
  "TEXT",
  "DECIMAL",
  "FLOAT",
  "DOUBLE",
  "DATE",
  "DATETIME",
  "TIMESTAMP",
  "BOOLEAN",
  "BLOB",
];

const DATA_ACCESS = [
  "",
  "CONTAINS SQL",
  "NO SQL",
  "READS SQL DATA",
  "MODIFIES SQL DATA",
];

export type FunctionWizardResult = {
  name: string;
  routineType: RoutineType;
  params: WizardParam[];
  returnsType: string;
  returnsLength: string;
  deterministic: boolean;
  dataAccess: string;
  securityType: string;
  skipped: boolean;
};

type Props = {
  onCancel: () => void;
  onComplete: (result: FunctionWizardResult) => void;
};

export function FunctionWizard({ onCancel, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("NewFunc");
  const [routineType, setRoutineType] = useState<RoutineType>("FUNCTION");
  const [params, setParams] = useState<WizardParam[]>([
    { name: "", typeName: "INT", length: "0", mode: "IN" },
  ]);
  const [selectedParam, setSelectedParam] = useState(0);
  const [returnsType, setReturnsType] = useState("INT");
  const [returnsLength, setReturnsLength] = useState("0");
  const [deterministic, setDeterministic] = useState(false);
  const [dataAccess, setDataAccess] = useState("");
  const [securityType, setSecurityType] = useState("");

  const isFunction = routineType === "FUNCTION";
  const lastStep = 2;

  function finish(skipped: boolean) {
    const cleanParams = params
      .filter((p) => p.name.trim() || p.typeName)
      .map((p, i) => ({
        ...p,
        name: p.name.trim() || `param${i + 1}`,
      }));
    onComplete({
      name: name.trim() || "NewFunc",
      routineType,
      params: cleanParams,
      returnsType,
      returnsLength,
      deterministic,
      dataAccess,
      securityType,
      skipped,
    });
  }

  function updateParam(i: number, patch: Partial<WizardParam>) {
    setParams((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    );
  }

  const titles = [
    "请选择你要创建的例程类型",
    "请输入这个例程的参数",
    "请选择函数会有的选项",
  ];

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="fn-wizard"
        role="dialog"
        aria-label="函数向导"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="fn-wizard-header">
          <h2>函数向导</h2>
          <p className="fn-wizard-hint">{titles[step]}</p>
        </header>

        <div className="fn-wizard-body">
          {step === 0 && (
            <div className="fn-wizard-step fn-wizard-step-type">
              <div className="fn-wz-field">
                <label htmlFor="fn-wz-name">名称:</label>
                <input
                  id="fn-wz-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="fn-wz-type-list" role="radiogroup">
                <label className="fn-wz-radio">
                  <input
                    type="radio"
                    name="fn-wz-kind"
                    checked={routineType === "FUNCTION"}
                    onChange={() => setRoutineType("FUNCTION")}
                  />
                  <span>函数</span>
                </label>
                <label className="fn-wz-radio">
                  <input
                    type="radio"
                    name="fn-wz-kind"
                    checked={routineType === "PROCEDURE"}
                    onChange={() => setRoutineType("PROCEDURE")}
                  />
                  <span>过程</span>
                </label>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="fn-wizard-step fn-wizard-step-params">
              <div className="fn-wz-field fn-wz-field-top">
                <span className="fn-wz-label">参数:</span>
                <div className="fn-wz-params-panel">
                  <div className="fn-wz-params-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>名称</th>
                          {routineType === "PROCEDURE" && <th>模式</th>}
                          <th>类型</th>
                          <th>长度</th>
                        </tr>
                      </thead>
                      <tbody>
                        {params.length === 0 && (
                          <tr>
                            <td
                              colSpan={routineType === "PROCEDURE" ? 4 : 3}
                              className="fn-wz-empty"
                            >
                              点击 + 添加参数
                            </td>
                          </tr>
                        )}
                        {params.map((p, i) => (
                          <tr
                            key={i}
                            className={
                              selectedParam === i ? "is-selected" : undefined
                            }
                            onClick={() => setSelectedParam(i)}
                          >
                            <td>
                              <input
                                value={p.name}
                                placeholder={`param${i + 1}`}
                                onChange={(e) =>
                                  updateParam(i, { name: e.target.value })
                                }
                              />
                            </td>
                            {routineType === "PROCEDURE" && (
                              <td>
                                <select
                                  value={p.mode}
                                  onChange={(e) =>
                                    updateParam(i, {
                                      mode: e.target
                                        .value as WizardParam["mode"],
                                    })
                                  }
                                >
                                  <option value="IN">IN</option>
                                  <option value="OUT">OUT</option>
                                  <option value="INOUT">INOUT</option>
                                </select>
                              </td>
                            )}
                            <td>
                              <select
                                value={p.typeName}
                                onChange={(e) =>
                                  updateParam(i, { typeName: e.target.value })
                                }
                              >
                                {DATA_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                value={p.length}
                                onChange={(e) =>
                                  updateParam(i, { length: e.target.value })
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="fn-wz-param-tools">
                    <button
                      type="button"
                      title="添加"
                      onClick={() => {
                        setParams((prev) => [
                          ...prev,
                          {
                            name: "",
                            typeName: "INT",
                            length: "0",
                            mode: "IN",
                          },
                        ]);
                        setSelectedParam(params.length);
                      }}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      title="删除"
                      disabled={params.length === 0}
                      onClick={() => {
                        if (params.length === 0) return;
                        setParams((prev) =>
                          prev.filter((_, i) => i !== selectedParam),
                        );
                        setSelectedParam((s) => Math.max(0, s - 1));
                      }}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      title="上移"
                      disabled={selectedParam <= 0}
                      onClick={() => {
                        if (selectedParam <= 0) return;
                        setParams((prev) => {
                          const next = [...prev];
                          const t = next[selectedParam - 1]!;
                          next[selectedParam - 1] = next[selectedParam]!;
                          next[selectedParam] = t;
                          return next;
                        });
                        setSelectedParam((s) => s - 1);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      title="下移"
                      disabled={selectedParam >= params.length - 1}
                      onClick={() => {
                        if (selectedParam >= params.length - 1) return;
                        setParams((prev) => {
                          const next = [...prev];
                          const t = next[selectedParam + 1]!;
                          next[selectedParam + 1] = next[selectedParam]!;
                          next[selectedParam] = t;
                          return next;
                        });
                        setSelectedParam((s) => s + 1);
                      }}
                    >
                      ↓
                    </button>
                  </div>
                </div>
              </div>

              {isFunction && (
                <div className="fn-wz-field fn-wz-return">
                  <span className="fn-wz-label">返回类型:</span>
                  <div className="fn-wz-return-controls">
                    <select
                      value={returnsType}
                      onChange={(e) => setReturnsType(e.target.value)}
                    >
                      {DATA_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <span className="fn-wz-paren">(</span>
                    <input
                      className="fn-wz-len"
                      value={returnsLength}
                      onChange={(e) => setReturnsLength(e.target.value)}
                    />
                    <span className="fn-wz-paren">)</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="fn-wizard-step fn-wizard-step-options">
              <label className="fn-wz-check">
                <input
                  type="checkbox"
                  checked={deterministic}
                  onChange={(e) => setDeterministic(e.target.checked)}
                />
                <span>具有确定性</span>
              </label>
              <div className="fn-wz-field">
                <label htmlFor="fn-wz-data">数据选项:</label>
                <select
                  id="fn-wz-data"
                  value={dataAccess}
                  onChange={(e) => setDataAccess(e.target.value)}
                >
                  {DATA_ACCESS.map((d) => (
                    <option key={d || "empty"} value={d}>
                      {d || ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="fn-wz-field">
                <label htmlFor="fn-wz-sec">SQL 安全性:</label>
                <select
                  id="fn-wz-sec"
                  value={securityType}
                  onChange={(e) => setSecurityType(e.target.value)}
                >
                  <option value="" />
                  <option value="DEFINER">DEFINER</option>
                  <option value="INVOKER">INVOKER</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <footer className="fn-wizard-footer">
          <div className="fn-wizard-footer-left">
            {step === 0 && (
              <button type="button" onClick={() => finish(true)}>
                跳过
              </button>
            )}
          </div>
          <div className="fn-wizard-footer-right">
            <button type="button" onClick={onCancel}>
              取消
            </button>
            <button
              type="button"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              上一步
            </button>
            <button
              type="button"
              disabled={step >= lastStep}
              onClick={() => setStep((s) => Math.min(lastStep, s + 1))}
            >
              下一步
            </button>
            <button
              type="button"
              className="is-primary"
              disabled={step < lastStep}
              onClick={() => finish(false)}
            >
              完成
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
