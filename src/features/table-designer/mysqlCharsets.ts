/** Common MySQL charsets and their collations (fallback when SHOW fails). */

export const MYSQL_CHARSETS = [
  "utf8mb4",
  "utf8mb3",
  "utf8",
  "latin1",
  "ascii",
  "binary",
  "gbk",
  "gb2312",
  "big5",
  "ujis",
  "sjis",
  "euckr",
  "cp1251",
  "cp1252",
] as const;

export const MYSQL_COLLATIONS_BY_CHARSET: Record<string, string[]> = {
  utf8mb4: [
    "utf8mb4_unicode_ci",
    "utf8mb4_general_ci",
    "utf8mb4_bin",
    "utf8mb4_0900_ai_ci",
    "utf8mb4_unicode_520_ci",
    "utf8mb4_chinese_ci",
  ],
  utf8mb3: ["utf8mb3_general_ci", "utf8mb3_unicode_ci", "utf8mb3_bin"],
  utf8: ["utf8_general_ci", "utf8_unicode_ci", "utf8_bin"],
  latin1: ["latin1_swedish_ci", "latin1_general_ci", "latin1_bin"],
  ascii: ["ascii_general_ci", "ascii_bin"],
  binary: ["binary"],
  gbk: ["gbk_chinese_ci", "gbk_bin"],
  gb2312: ["gb2312_chinese_ci", "gb2312_bin"],
  big5: ["big5_chinese_ci", "big5_bin"],
  ujis: ["ujis_japanese_ci", "ujis_bin"],
  sjis: ["sjis_japanese_ci", "sjis_bin"],
  euckr: ["euckr_korean_ci", "euckr_bin"],
  cp1251: ["cp1251_general_ci", "cp1251_bin"],
  cp1252: ["cp1252_general_ci", "cp1252_bin"],
};

export function collationsForCharset(charset: string): string[] {
  const list = MYSQL_COLLATIONS_BY_CHARSET[charset];
  if (list?.length) return list;
  return [`${charset}_general_ci`, `${charset}_bin`];
}

export function defaultCollationForCharset(charset: string): string {
  return collationsForCharset(charset)[0] || `${charset}_general_ci`;
}

/** Types that typically use length / decimals inputs. */
export function typeSupportsLength(typeName: string): boolean {
  const t = typeName.toLowerCase();
  return [
    "varchar",
    "char",
    "binary",
    "varbinary",
    "decimal",
    "numeric",
    "float",
    "double",
    "bit",
  ].includes(t);
}

export function typeSupportsDecimals(typeName: string): boolean {
  const t = typeName.toLowerCase();
  return ["decimal", "numeric", "float", "double"].includes(t);
}
