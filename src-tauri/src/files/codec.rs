use encoding_rs::{Encoding, GB18030, UTF_8, UTF_16BE, UTF_16LE, WINDOWS_1252};
use super::{fail, FileError, Result};

fn encoding(label: &str) -> Result<&'static Encoding> {
    match label {
        "UTF-8" => Ok(UTF_8), "UTF-16LE" => Ok(UTF_16LE), "UTF-16BE" => Ok(UTF_16BE),
        "GB18030" => Ok(GB18030), "windows-1252" => Ok(WINDOWS_1252),
        _ => fail("encoding", "不支持的编码。"),
    }
}

pub fn decode(bytes: &[u8], selected: Option<&str>) -> Result<(String, String, bool)> {
    if selected == Some("Hex") { return Ok((hex_text(bytes), "Hex".into(), false)); }
    if bytes.starts_with(super::classfile::MAGIC) { return fail("binary", "JVM ClassFile 不是所选文本编码，请直接打开为可编辑字节内容。"); }
    let detected = Encoding::for_bom(bytes);
    let enc = match selected { Some(label) => encoding(label)?, None => detected.map(|(enc, _)| enc).unwrap_or(UTF_8) };
    // An explicit incompatible encoding is never allowed to reinterpret a BOM.
    if detected.is_some_and(|(bom_enc, _)| bom_enc != enc) {
        return fail("encoding", "所选编码与 BOM 不一致，请选择匹配的编码。");
    }
    let skip = detected.map(|(_, size)| size).unwrap_or(0);
    let text = enc.decode_without_bom_handling_and_without_replacement(&bytes[skip..])
        .ok_or_else(|| FileError::new("encoding", "文件不是有效的所选编码；请通过“按编码打开文件”重试。不会用替换字符读取。"))?.into_owned();
    if text.chars().any(|ch| ch == '\0') { return fail("binary", "检测到二进制/NUL 数据，拒绝作为文本打开。"); }
    let label = if enc == GB18030 { "GB18030" } else { enc.name() };
    Ok((text, label.to_string(), skip > 0))
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
