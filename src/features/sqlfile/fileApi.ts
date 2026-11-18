import { invoke } from "../../lib/invoke";

/** 按指定编码把文本写入磁盘（后端 encoding_rs 实现），返回写入字节数。 */
export function writeTextFileEncoded(
  path: string,
  contents: string,
  encoding: string,
) {
  return invoke<number>("write_text_file", { path, contents, encoding });
}
