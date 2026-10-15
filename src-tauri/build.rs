fn main() {
    // Windows resource compilation reads the ICO outside Rust's include_bytes!
    // dependency tracking. Rebuild it when branding assets change.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    tauri_build::build()
}
