import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = String(pkg.version ?? "").trim();

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`[version] package.json 中的 version 非法: ${version || "(空)"}`);
  process.exit(1);
}

function update(relativePath, transform) {
  const file = path.join(root, relativePath);
  const before = readFileSync(file, "utf8");
  const after = transform(before);
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`[version] ${relativePath} -> ${version}`);
  }
}

// package-lock.json：根节点与 packages[""] 的 version
update("package-lock.json", (text) =>
  text.replace(
    /("name": "mycat",\s*\n\s*"version": ")[^"]+(")/g,
    `$1${version}$2`,
  ),
);

// Cargo.toml：仅同步 [package] 下第一处行首 version
update("src-tauri/Cargo.toml", (text) =>
  text.replace(/^version = "[^"]+"/m, `version = "${version}"`),
);

// Cargo.lock：仅同步 mycat 包自身的版本
update("src-tauri/Cargo.lock", (text) =>
  text.replace(
    /(\[\[package\]\]\nname = "mycat"\nversion = ")[^"]+(")/,
    `$1${version}$2`,
  ),
);

// tauri.conf.json：如果 version 是字面量则同步；如果是 ../package.json 路径则保持引用
update("src-tauri/tauri.conf.json", (text) =>
  text.replace(
    /("version":\s*")[0-9]+\.[0-9]+\.[0-9]+[^"]*(")/,
    `$1${version}$2`,
  ),
);

console.log(`[version] 当前版本: ${version}`);
