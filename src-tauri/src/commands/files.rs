use encoding_rs::Encoding;

fn encode(encoding: &'static Encoding, text: &str) -> Result<Vec<u8>, String> {
    let (bytes, _, had_errors) = encoding.encode(text);
    if had_errors {
        return Err(format!(
            "内容包含无法用 {} 编码的字符，请改用 UTF-8",
            encoding.name()
        ));
    }
    Ok(bytes.into_owned())
}

/// Write text to disk using the requested encoding (utf-8 / utf-8-bom / gbk /
/// gb18030 / big5 / utf-16le / utf-16be / latin1 ...).
#[tauri::command]
pub fn write_text_file(path: String, contents: String, encoding: String) -> Result<(), String> {
    let label = encoding.trim().to_ascii_lowercase();
    let mut out: Vec<u8> = Vec::new();

    match label.as_str() {
        "utf-8-bom" => {
            out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            out.extend(encode(encoding_rs::UTF_8, &contents)?);
        }
        "utf-16le" => {
            out.extend_from_slice(&[0xFF, 0xFE]);
            out.extend(encode(encoding_rs::UTF_16LE, &contents)?);
        }
        "utf-16be" => {
            out.extend_from_slice(&[0xFE, 0xFF]);
            out.extend(encode(encoding_rs::UTF_16BE, &contents)?);
        }
        other => {
            let enc = Encoding::for_label(other.as_bytes())
                .ok_or_else(|| format!("不支持的编码：{other}"))?;
            out.extend(encode(enc, &contents)?);
        }
    }

    std::fs::write(&path, out).map_err(|e| format!("写入文件失败：{e}"))
}
