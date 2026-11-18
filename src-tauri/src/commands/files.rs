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

/// encoding_rs 的 UTF-16 只支持解码，这里手动编码（含代理对）。
fn encode_utf16(text: &str, big_endian: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() * 2);
    for unit in text.encode_utf16() {
        if big_endian {
            out.push((unit >> 8) as u8);
            out.push(unit as u8);
        } else {
            out.push(unit as u8);
            out.push((unit >> 8) as u8);
        }
    }
    out
}

/// Write text to disk using the requested encoding (utf-8 / utf-8-bom / gbk /
/// gb18030 / big5 / utf-16le / utf-16be / latin1 ...).
/// Returns the number of bytes written.
#[tauri::command]
pub fn write_text_file(path: String, contents: String, encoding: String) -> Result<usize, String> {
    let label = encoding.trim().to_ascii_lowercase();
    let mut out: Vec<u8> = Vec::new();

    match label.as_str() {
        "utf-8-bom" => {
            out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            out.extend(encode(encoding_rs::UTF_8, &contents)?);
        }
        "utf-16le" => {
            out.extend_from_slice(&[0xFF, 0xFE]);
            out.extend(encode_utf16(&contents, false));
        }
        "utf-16be" => {
            out.extend_from_slice(&[0xFE, 0xFF]);
            out.extend(encode_utf16(&contents, true));
        }
        other => {
            let enc = Encoding::for_label(other.as_bytes())
                .ok_or_else(|| format!("不支持的编码：{other}"))?;
            out.extend(encode(enc, &contents)?);
        }
    }

    std::fs::write(&path, &out).map_err(|e| format!("写入文件失败：{e}"))?;
    Ok(out.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> String {
        std::env::temp_dir()
            .join(name)
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn writes_gbk() {
        let path = temp_path("mycat-enc-gbk.sql");
        write_text_file(path.clone(), "CREATE TABLE 中文;".into(), "gbk".into()).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let (text, _, had_errors) = encoding_rs::GBK.decode(&bytes);
        assert!(!had_errors);
        assert_eq!(text, "CREATE TABLE 中文;");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn writes_utf16le_with_bom() {
        let path = temp_path("mycat-enc-utf16.sql");
        write_text_file(path.clone(), "SELECT 1;".into(), "utf-16le".into()).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..2], &[0xFF, 0xFE]);
        let (text, _, had_errors) = encoding_rs::UTF_16LE.decode(&bytes);
        assert!(!had_errors);
        assert_eq!(text, "SELECT 1;");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_unknown_encoding() {
        let path = temp_path("mycat-enc-bad.sql");
        assert!(write_text_file(path, "SELECT 1;".into(), "no-such-enc".into()).is_err());
    }
}
