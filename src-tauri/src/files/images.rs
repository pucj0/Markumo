//! Read only explicitly scoped raster images. Never expose a file:// asset scope.
use super::{checked_path, fail, read_disk, FileError, FileService, Result};
use std::path::{Component, Path, PathBuf};

const MAX_IMAGE_BYTES: usize = 4 * 1024 * 1024;
pub fn dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.get(12..16) == Some(b"IHDR") {
        return Some((u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?), u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?)));
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some((u16::from_le_bytes(bytes.get(6..8)?.try_into().ok()?) as u32, u16::from_le_bytes(bytes.get(8..10)?.try_into().ok()?) as u32));
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        let data = bytes.get(20..)?;
        return match bytes.get(12..16)? {
            b"VP8X" => Some((1 + u32::from_le_bytes([*data.get(4)?, *data.get(5)?, *data.get(6)?, 0]), 1 + u32::from_le_bytes([*data.get(7)?, *data.get(8)?, *data.get(9)?, 0]))),
            b"VP8L" if data.first() == Some(&0x2f) => { let bits = u32::from_le_bytes(data.get(1..5)?.try_into().ok()?); Some((1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff))) },
            b"VP8 " if data.get(3..6) == Some(&[0x9d, 0x01, 0x2a]) => Some(((u16::from_le_bytes(data.get(6..8)?.try_into().ok()?) & 0x3fff) as u32, (u16::from_le_bytes(data.get(8..10)?.try_into().ok()?) & 0x3fff) as u32)),
            _ => None,
        };
    }
    if bytes.starts_with(&[0xff, 0xd8]) {
        let mut offset = 2;
        while offset < bytes.len() {
            if *bytes.get(offset)? != 0xff { return None; }
            while bytes.get(offset) == Some(&0xff) { offset += 1; }
            let marker = *bytes.get(offset)?; offset += 1;
            if marker == 0xda || marker == 0xd9 { return None; }
            if marker == 1 || (0xd0..=0xd7).contains(&marker) { continue; }
            let length = u16::from_be_bytes(bytes.get(offset..offset+2)?.try_into().ok()?) as usize;
            if length < 2 || offset.checked_add(length)? > bytes.len() { return None; }
            if [0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].contains(&marker) && length >= 7 {
                return Some((u16::from_be_bytes(bytes.get(offset+5..offset+7)?.try_into().ok()?) as u32, u16::from_be_bytes(bytes.get(offset+3..offset+5)?.try_into().ok()?) as u32));
            }
            offset += length;
        }
    }
    None
}

impl FileService {
    pub fn markdown_image(&self, token: &str, relative: &str, roots: &[PathBuf]) -> Result<Vec<u8>> {
        let document = self.validate(token, false)?;
        if relative.is_empty() || relative.contains([':', '\0', '?', '#']) || relative.starts_with(['/', '\\']) || relative.len() > 4096 {
            return fail("image_scope", "仅支持授权范围内的相对图片路径。");
        }
        let mut target = document.parent().unwrap().to_path_buf();
        let relative = relative.replace('\\', "/");
        for component in Path::new(&relative).components() {
            match component { Component::Normal(part) => target.push(part), Component::CurDir => {}, Component::ParentDir => { if !target.pop() { return fail("image_scope", "图片路径超出授权范围。"); } }, _ => return fail("image_scope", "图片路径无效。") }
        }
        let canonical = checked_path(&target, false)?;
        crate::workspace::guard::validate_under_root(canonical.parent().unwrap(), &target)
            .map_err(|error| FileError::new("image_scope", &error.to_string()))?;
        // Selecting a Markdown file alone does not grant arbitrary sibling reads.
        let authorized = roots.iter().any(|root| crate::workspace::guard::validate_under_root(root, &target).is_ok()) || self.grants.values().any(|grant| grant.owner == self.current_owner && grant.canonical == canonical);
        if !authorized { return fail("image_scope", "图片未获授权，请将所在文件夹加入工作区后重试。"); }
        let metadata = std::fs::metadata(&canonical).map_err(FileError::io)?;
        if metadata.len() > MAX_IMAGE_BYTES as u64 { return fail("image_size", "图片超过 4 MiB，已保留可编辑路径。"); }
        let (bytes, _, _) = read_disk(&canonical)?;
        if checked_path(&target, false)? != canonical { return fail("image_scope", "读取期间图片路径发生变化，请重试。"); }
        if bytes.len() > MAX_IMAGE_BYTES { return fail("image_size", "图片超过 4 MiB。"); }
        let (width, height) = dimensions(&bytes).ok_or_else(|| FileError::new("image_format", "仅预览 PNG、JPEG、GIF、WebP；损坏图片或 SVG 保留源码。"))?;
        if width == 0 || height == 0 || width > 16384 || height > 16384 || width as u64 * height as u64 > 16_000_000 { return fail("image_size", "图片尺寸超过安全预览范围。"); }
        Ok(bytes)
    }
}
