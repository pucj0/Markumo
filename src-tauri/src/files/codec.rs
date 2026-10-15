use encoding_rs::{Encoding, GB18030, UTF_8, UTF_16BE, UTF_16LE, WINDOWS_1252};
use super::{fail, FileError, Result};
use std::path::Path;

pub fn encoding(label: &str) -> Result<&'static Encoding> {
    match label {
        "UTF-8" => Ok(UTF_8),
        "UTF-16LE" => Ok(UTF_16LE),
        "UTF-16BE" => Ok(UTF_16BE),
        "GB18030" | "GBK" | "GB2312" | "CP936" => Ok(GB18030),
        "windows-1252" => Ok(WINDOWS_1252),
        _ => fail("encoding", "不支持的编码。"),
    }
}

fn is_known_binary_magic(bytes: &[u8]) -> bool {
    bytes.starts_with(super::classfile::MAGIC) // 0xCAFEBABE ClassFile
        || bytes.starts_with(b"\x89PNG\r\n\x1a\n") // PNG
        || bytes.starts_with(b"\xff\xd8\xff") // JPEG
        || bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") // GIF
        || bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") || bytes.starts_with(b"PK\x07\x08") // ZIP/JAR/DOCX
        || bytes.starts_with(b"%PDF-") // PDF
        || bytes.starts_with(b"\x1f\x8b") // GZIP
        || bytes.starts_with(b"7z\xbc\xaf\x27\x1c") // 7Z
        || bytes.starts_with(b"Rar!\x1a\x07") // RAR
        || bytes.starts_with(b"MZ") // Windows PE / EXE / DLL
        || bytes.starts_with(b"\x7fELF") // ELF binary
}

fn is_text_like_extension(path: Option<&Path>) -> bool {
    let Some(p) = path else { return true; };
    let Some(ext) = p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()) else {
        return true;
    };
    matches!(
        ext.as_str(),
        "bat" | "cmd" | "txt" | "csv" | "tsv" | "ini" | "cfg" | "conf" | "properties"
        | "log" | "md" | "markdown" | "json" | "jsonc" | "xml" | "yaml" | "yml"
        | "sql" | "sh" | "java" | "py" | "js" | "jsx" | "ts" | "tsx" | "c" | "cpp"
        | "h" | "hpp" | "rs" | "go" | "html" | "htm" | "css" | "scss" | "reg" | "inf"
        | "toml" | "vue" | "ps1" | "vbs" | "bas"
    )
}

fn has_binary_control_chars(bytes: &[u8]) -> bool {
    bytes.iter().any(|&b| {
        b < 0x20 && b != b'\t' && b != b'\n' && b != b'\r' && b != 0x0c && b != 0x1b
    })
}

pub fn decode(bytes: &[u8], selected: Option<&str>) -> Result<(String, String, bool)> {
    decode_with_path(bytes, selected, None)
}

pub fn decode_with_path(bytes: &[u8], selected: Option<&str>, path: Option<&Path>) -> Result<(String, String, bool)> {
    if selected == Some("Hex") { return Ok((hex_text(bytes), "Hex".into(), false)); }
    if bytes.starts_with(super::classfile::MAGIC) { return fail("binary", "JVM ClassFile 不是所选文本编码，请直接打开为可编辑字节内容。"); }

    let detected = Encoding::for_bom(bytes);

    // 1. Explicit encoding selected by caller
    if let Some(label) = selected {
        let enc = encoding(label)?;
        // An explicit incompatible encoding is never allowed to reinterpret a BOM.
        if detected.is_some_and(|(bom_enc, _)| bom_enc != enc) {
            return fail("encoding", "所选编码与 BOM 不一致，请选择匹配的编码。");
        }
        let skip = detected.map(|(_, size)| size).unwrap_or(0);
        let text = enc.decode_without_bom_handling_and_without_replacement(&bytes[skip..])
            .ok_or_else(|| FileError::new("encoding", "文件不是有效的所选编码；请通过“按编码打开文件”重试。不会用替换字符读取。"))?.into_owned();
        if text.chars().any(|ch| ch == '\0') { return fail("binary", "检测到二进制/NUL 数据，拒绝作为文本打开。"); }
        let label = if enc == GB18030 { "GB18030" } else { enc.name() };
        return Ok((text, label.to_string(), skip > 0));
    }

    // 2. Automatic detection: Check BOM
    if let Some((bom_enc, size)) = detected {
        let text = bom_enc.decode_without_bom_handling_and_without_replacement(&bytes[size..])
            .ok_or_else(|| FileError::new("encoding", "BOM 声明的编码内容无效。"))?.into_owned();
        if text.chars().any(|ch| ch == '\0') { return fail("binary", "检测到二进制/NUL 数据，拒绝作为文本打开。"); }
        let label = if bom_enc == GB18030 { "GB18030" } else { bom_enc.name() };
        return Ok((text, label.to_string(), true));
    }

    // 3. No BOM: Strict binary checks
    if is_known_binary_magic(bytes) {
        return fail("binary", "检测到已知二进制文件魔数，拒绝作为文本打开。");
    }
    if bytes.contains(&0x00) {
        return fail("binary", "检测到二进制/NUL 数据，拒绝作为文本打开。");
    }
    if has_binary_control_chars(bytes) {
        return fail("binary", "检测到二进制控制字符，拒绝作为文本打开。");
    }

    // 4. Prefer strict UTF-8
    if let Some(text) = UTF_8.decode_without_bom_handling_and_without_replacement(bytes) {
        return Ok((text.into_owned(), "UTF-8".into(), false));
    }

    // 5. UTF-8 failed: attempt legacy text detection for text-like files
    if is_text_like_extension(path) {
        // A. Attempt GB18030 (subsumes GBK and GB2312, CP936)
        if let Some(text) = GB18030.decode_without_bom_handling_and_without_replacement(bytes) {
            let valid_text = !text.chars().any(|ch| {
                ch.is_control() && ch != '\t' && ch != '\n' && ch != '\r' && ch != '\x0c' && ch != '\x1b'
            });
            if valid_text {
                let (re_encoded, _, unmappable) = GB18030.encode(&text);
                // Strict lossless round-trip byte-for-byte check
                if !unmappable && re_encoded.as_ref() == bytes {
                    let cjk_count = text.chars().filter(|&ch| {
                        ('\u{4E00}'..='\u{9FFF}').contains(&ch)
                        || ('\u{3400}'..='\u{4DBF}').contains(&ch)
                        || ('\u{F900}'..='\u{FAFF}').contains(&ch)
                        || ('\u{3000}'..='\u{303F}').contains(&ch)
                        || ('\u{FF00}'..='\u{FFEF}').contains(&ch)
                    }).count();

                    if cjk_count > 0 {
                        return Ok((text.into_owned(), "GB18030".into(), false));
                    }
                }
            }
        }

        // B. Attempt Windows-1252 (Western European with accented characters)
        if let Some(text) = WINDOWS_1252.decode_without_bom_handling_and_without_replacement(bytes) {
            let valid_text = !text.chars().any(|ch| {
                ch.is_control() && ch != '\t' && ch != '\n' && ch != '\r' && ch != '\x0c' && ch != '\x1b'
            });
            let (re_encoded, _, unmappable) = WINDOWS_1252.encode(&text);
            if valid_text && !unmappable && re_encoded.as_ref() == bytes {
                let latin_ext = text.chars().any(|ch| ('\u{00A0}'..='\u{00FF}').contains(&ch));
                if latin_ext {
                    return Ok((text.into_owned(), "windows-1252".into(), false));
                }
            }
        }
    }

    fail("encoding", "文件含有非 UTF-8 字节且无法自动识别为传统文本编码；请在状态栏选择编码。")
}

pub fn encode(text: &str, label: &str, bom: bool) -> Result<Vec<u8>> {
    if label == "Hex" {
        if bom { return fail("encoding", "十六进制字节模式不额外添加 BOM。"); }
        let mut bytes = Vec::new();
        let mut high = None;
        for ch in text.chars() {
            if ch.is_ascii_whitespace() { continue; }
            let digit = ch.to_digit(16).filter(|_| ch.is_ascii()).ok_or_else(|| FileError::new("hex", "十六进制内容只能包含 0–9、A–F 和空白；原文件未修改。"))? as u8;
            if let Some(value) = high.take() { bytes.push(value * 16 + digit); }
            else { high = Some(digit); }
        }
        if high.is_some() { return fail("hex", "十六进制字节缺少一位；原文件未修改。"); }
        return Ok(bytes);
    }
    let enc = encoding(label)?;
    let mut bytes = Vec::new();
    match label {
        "UTF-16LE" | "UTF-16BE" => {
            if bom { bytes.extend_from_slice(if label == "UTF-16LE" { &[0xff, 0xfe] } else { &[0xfe, 0xff] }); }
            for unit in text.encode_utf16() {
                bytes.extend_from_slice(&if label == "UTF-16LE" { unit.to_le_bytes() } else { unit.to_be_bytes() });
            }
        }
        _ => {
            if bom && label != "UTF-8" { return fail("encoding", "该编码不支持 BOM。"); }
            if bom { bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]); }
            let (encoded, _, errors) = enc.encode(text);
            if errors { return fail("encoding_loss", "当前编码无法表示全部字符，已阻止有损保存。请另存为 UTF-8。" ); }
            // Some legacy encodings have non-bijective mappings; reject lossy round trips.
            let round_trip = enc.decode_without_bom_handling_and_without_replacement(&encoded);
            if round_trip.as_deref() != Some(text) { return fail("encoding_loss", "编码往返校验失败，已阻止有损保存。" ); }
            bytes.extend_from_slice(&encoded);
        }
    }
    Ok(bytes)
}

// A reversible byte representation, never a replacement-character text decode.
pub fn hex_text(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789ABCDEF";
    let mut text = String::with_capacity(bytes.len() * 3);
    for (index, byte) in bytes.iter().enumerate() {
        if index > 0 { text.push(if index % 32 == 0 { '\n' } else { ' ' }); }
        text.push(HEX[(byte >> 4) as usize] as char);
        text.push(HEX[(byte & 15) as usize] as char);
    }
    text
}

pub fn eol(text: &str) -> String {
    let mut lf = false; let mut crlf = false; let mut cr = false;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\r' { if chars.peek() == Some(&'\n') { chars.next(); crlf = true; } else { cr = true; } }
        else if ch == '\n' { lf = true; }
    }
    (if (lf as u8 + crlf as u8 + cr as u8) > 1 { "Mixed" }
    else if crlf { "CRLF" } else if cr { "CR" } else { "LF" }).to_string()
}
