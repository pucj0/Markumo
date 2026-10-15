#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf, sync::atomic::Ordering};
    use tempfile::tempdir;

    use crate::workspace::{
        guard::validate_under_root,
        search::{SearchManager, SearchQuery, WorkspaceSearcher},
        service::WorkspaceService,
    };

    #[test]
    fn explorer_reveal_uses_live_workspace_scope_and_existing_nodes() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("root");
        let outside = dir.path().join("outside.txt");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("中文 文件.txt"), "data").unwrap();
        fs::write(&outside, "outside").unwrap();
        let mut service = WorkspaceService::default();
        service.open_workspace(root.clone()).unwrap();
        assert_eq!(service.revealed_path(&root).unwrap(), root.canonicalize().unwrap());
        assert!(service.revealed_path(&root.join("中文 文件.txt")).is_ok());
        assert!(service.revealed_path(&outside).is_err());
        assert!(service.revealed_path(&root.join("../outside.txt")).is_err());
        assert!(service.revealed_path(&root.join("missing.txt")).is_err());
        service.remove_workspace(&root.canonicalize().unwrap()).unwrap();
        assert!(service.revealed_path(&root).is_err());
    }

    #[test]
    fn multiple_roots_keep_separate_scope_and_persist_without_deleting_files() {
        let dir = tempdir().unwrap();
        let a = dir.path().join("a");
        let b = dir.path().join("b");
        let outside = dir.path().join("outside");
        for path in [&a, &b, &outside] {
            fs::create_dir(path).unwrap();
            fs::write(path.join("same.txt"), "needle data").unwrap();
        }
        let prefs = dir.path().join("workspaces.json");
        let mut service = WorkspaceService::default();
        service.configure(prefs.clone());
        service.open_workspace(a.clone()).unwrap();
        service.add_workspace(b.clone()).unwrap();
        service.add_workspace(b.clone()).unwrap();
        assert_eq!(service.roots().len(), 2);
        assert!(service.read_directory(&b).is_ok());
        assert!(service.read_directory(&outside).is_err());
        let created = service.create_file(&b, "created.txt").unwrap();
        assert!(PathBuf::from(created.path).exists());
        assert!(service.move_node(&a.join("same.txt"), &b).is_err());
        assert!(service.delete_node(&b).is_err());
        let mut restored = WorkspaceService::default();
        restored.configure(prefs);
        assert_eq!(restored.restore_workspaces().unwrap().len(), 2);
        restored
            .remove_workspace(&a.canonicalize().unwrap())
            .unwrap();
        assert_eq!(restored.roots().len(), 1);
        assert!(restored.read_directory(&a).is_err());
        assert!(a.join("same.txt").exists());
        assert!(restored.read_directory(&b).is_ok());
    }

    #[test]
    fn multiple_root_search_streams_all_roots_with_one_limit_and_cancellation() {
        let dir = tempdir().unwrap();
        let roots = vec![dir.path().join("a"), dir.path().join("b")];
        for root in &roots {
            fs::create_dir(root).unwrap();
            fs::write(root.join("same.txt"), "needle needle").unwrap();
        }
        let query = SearchQuery {
            search_id: "multi".into(),
            query: "needle".into(),
            is_case_sensitive: false,
            is_whole_word: false,
            is_regex: false,
            max_results: Some(3),
            include_ignored: false,
        };
        let token = SearchManager::default().create_token("multi");
        let mut matches = Vec::new();
        let total =
            WorkspaceSearcher::execute_search_roots(&roots, &query, token.clone(), |batch| {
                matches.extend(batch)
            })
            .unwrap();
        assert_eq!(total, 3);
        assert!(matches
            .iter()
            .any(|item| item.relative_path.starts_with("a/")));
        assert!(matches
            .iter()
            .any(|item| item.relative_path.starts_with("b/")));
        token.store(true, Ordering::Relaxed);
        assert_eq!(
            WorkspaceSearcher::execute_search_roots(&roots, &query, token, |_| panic!(
                "canceled batch"
            ))
            .unwrap(),
            0
        );
    }

    #[cfg(windows)]
    #[test]
    fn exclusive_native_rename_never_overwrites_an_existing_target() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.txt");
        let target = dir.path().join("external.txt");
        fs::write(&source, "source data").unwrap();
        fs::write(&target, "external data").unwrap();
        assert!(crate::workspace::service::rename_without_overwrite(&source, &target).is_err());
        assert_eq!(fs::read_to_string(&source).unwrap(), "source data");
        assert_eq!(fs::read_to_string(&target).unwrap(), "external data");
    }

    #[test]
    fn workspace_history_persists_separately_and_failed_open_preserves_root() {
        let dir = tempdir().unwrap();
        let a = dir.path().join("a");
        let b = dir.path().join("b");
        fs::create_dir(&a).unwrap();
        fs::create_dir(&b).unwrap();
        let prefs = dir.path().join("workspaces.json");
        let mut service = WorkspaceService::default();
        service.configure(prefs.clone());
        service.open_workspace(a.clone()).unwrap();
        service.open_workspace(b.clone()).unwrap();
        assert!(service.open_workspace(dir.path().join("missing")).is_err());
        assert_eq!(
            service.current_root(),
            Some(b.canonicalize().unwrap().as_path())
        );
        let mut restored = WorkspaceService::default();
        restored.configure(prefs);
        assert_eq!(
            restored.recent_workspaces(),
            vec![
                b.canonicalize().unwrap().to_string_lossy().into_owned(),
                a.canonicalize().unwrap().to_string_lossy().into_owned()
            ]
        );
    }

    #[test]
    fn search_columns_use_utf16_and_batches_are_bounded() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("unicode.txt"),
            format!("中文🚀{}", "hit ".repeat(100)),
        )
        .unwrap();
        let query = SearchQuery {
            search_id: "utf16".into(),
            query: "hit".into(),
            is_case_sensitive: false,
            is_whole_word: false,
            is_regex: false,
            max_results: Some(100),
            include_ignored: false,
        };
        let token = SearchManager::default().create_token("utf16");
        let mut batches = Vec::new();
        let total = WorkspaceSearcher::execute_search(dir.path(), &query, token, |batch| {
            batches.push(batch)
        })
        .unwrap();
        assert_eq!(total, 100);
        assert_eq!(batches[0][0].column_number, 5);
        assert!(batches.iter().all(|batch| batch.len() <= 32));
    }

    #[test]
    fn gitignore_exact_negation_nested_and_override() {
        let dir = tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::write(
            root.join(".gitignore"),
            "ignored.txt\n*.log\n!keep.log\n/root-only.txt\ncache/\n",
        )
        .unwrap();
        for name in [
            "ignored.txt",
            "not-ignored.txt",
            "skip.log",
            "keep.log",
            "root-only.txt",
        ] {
            fs::write(root.join(name), "hello").unwrap();
        }
        fs::create_dir(root.join("nested")).unwrap();
        fs::write(root.join("nested/.gitignore"), "local.txt\n!nested.log\n").unwrap();
        for name in ["local.txt", "nested.log", "root-only.txt"] {
            fs::write(root.join("nested").join(name), "hello").unwrap();
        }
        let mut service = WorkspaceService::default();
        let info = service.open_workspace(root.clone()).unwrap();
        let names: Vec<_> = info.entries.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"not-ignored.txt") && names.contains(&"keep.log"));
        assert!(
            !names.contains(&"ignored.txt")
                && !names.contains(&"skip.log")
                && !names.contains(&"root-only.txt")
        );
        let entries = service.read_directory(&root.join("nested")).unwrap();
        assert!(entries.iter().any(|n| n.name == "nested.log"));
        assert!(entries.iter().any(|n| n.name == "root-only.txt"));
        assert!(!entries.iter().any(|n| n.name == "local.txt"));
        service.show_ignored = true;
        assert!(service
            .read_directory(&root)
            .unwrap()
            .iter()
            .any(|n| n.name == "ignored.txt"));
    }

    #[test]
    fn names_root_moves_and_collisions_are_rejected_without_data_loss() {
        let dir = tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let mut service = WorkspaceService::default();
        service.open_workspace(root.clone()).unwrap();
        service.create_directory(&root, "src").unwrap();
        fs::write(root.join("existing.txt"), "preserve").unwrap();
        for name in ["../escape", "src/escape", "NUL.txt", "a:b", "..", "bad."] {
            assert!(service.create_file(&root, name).is_err());
            assert!(service
                .rename_node(&root.join("existing.txt"), name)
                .is_err());
        }
        assert!(service.create_file(&root, "existing.txt").is_err());
        assert_eq!(
            fs::read_to_string(root.join("existing.txt")).unwrap(),
            "preserve"
        );
        assert!(service.move_node(&root, &root.join("src")).is_err());
        assert!(service
            .move_node(&root.join("src"), &root.join("src"))
            .is_err());
    }

    #[test]
    fn search_streams_cancel_mid_file_and_supports_bom_cr_and_utf16() {
        let dir = tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("many.txt"), "hit\n".repeat(5000)).unwrap();
        let token = SearchManager::default().create_token("cancel");
        let query = SearchQuery {
            search_id: "cancel".into(),
            query: "hit".into(),
            is_case_sensitive: false,
            is_whole_word: false,
            is_regex: false,
            max_results: None,
            include_ignored: false,
        };
        let mut batches = 0;
        WorkspaceSearcher::execute_search(&root, &query, token.clone(), |batch| {
            assert_eq!(batch.len(), 32);
            batches += 1;
            token.store(true, Ordering::Relaxed);
        })
        .unwrap();
        assert_eq!(batches, 1);
        fs::remove_file(root.join("many.txt")).unwrap();
        let mut bytes = vec![0xff, 0xfe];
        for ch in "中文🚀hit\rhit".encode_utf16() {
            bytes.extend(ch.to_le_bytes());
        }
        fs::write(root.join("utf16.txt"), bytes).unwrap();
        let mut matches = Vec::new();
        WorkspaceSearcher::execute_search(
            &root,
            &query,
            SearchManager::default().create_token("new"),
            |batch| matches.extend(batch),
        )
        .unwrap();
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].column_number, 5);
        assert_eq!(matches[1].line_number, 2);
    }

    #[test]
    fn quick_open_finds_unexpanded_nested_files_and_tree_stays_shallow_at_ten_thousand_files() {
        let dir = tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        for i in 0..100 {
            let sub = root.join(format!("folder-{i}"));
            fs::create_dir(&sub).unwrap();
            for j in 0..100 {
                fs::write(sub.join(format!("file-{j}.txt")), "text").unwrap();
            }
        }
        let mut service = WorkspaceService::default();
        let start = std::time::Instant::now();
        let info = service.open_workspace(root.clone()).unwrap();
        assert_eq!(info.entries.len(), 100);
        assert!(info.entries.iter().all(|n| n.is_directory));
        println!("10,000-file shallow directory load: {:?}", start.elapsed());
        let files = crate::workspace::search::find_files(&root, "f99/f99", false).unwrap();
        assert!(files
            .iter()
            .any(|f| f.relative_path == "folder-99/file-99.txt"));
    }

    #[cfg(windows)]
    #[test]
    fn junctions_are_not_followed_for_listing_search_or_mutations() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("workspace");
        let outside = dir.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "secret").unwrap();
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(root.join("junction"))
            .arg(&outside)
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "{}",
            String::from_utf8_lossy(&status.stderr)
        );
        let mut service = WorkspaceService::default();
        let info = service.open_workspace(root.clone()).unwrap();
        assert!(!info.entries.iter().any(|n| n.name == "junction"));
        assert!(service
            .delete_node(&root.join("junction/secret.txt"))
            .is_err());
        assert!(service
            .create_file(&root.join("junction"), "new.txt")
            .is_err());
        assert!(crate::workspace::search::find_files(
            &root.canonicalize().unwrap(),
            "secret",
            true
        )
        .unwrap()
        .is_empty());
        assert_eq!(
            fs::read_to_string(outside.join("secret.txt")).unwrap(),
            "secret"
        );
    }

    #[test]
    fn path_traversal_is_strictly_denied() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("workspace");
        fs::create_dir_all(&root).unwrap();

        let outside_file = dir.path().join("secret.txt");
        fs::write(&outside_file, "secret").unwrap();

        let traversal = root.join("../secret.txt");
        let result = validate_under_root(&root, &traversal);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("访问受限"));
    }

    #[test]
    fn workspace_crud_and_sorting() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("project");
        fs::create_dir_all(&root).unwrap();

        let mut service = WorkspaceService::default();
        let info = service.open_workspace(root.clone()).unwrap();
        assert_eq!(info.entries.len(), 0);

        // 创建子目录和文件
        let sub_dir = service.create_directory(&root, "src").unwrap();
        assert!(sub_dir.is_directory);

        let file = service.create_file(&root.join("src"), "main.rs").unwrap();
        assert!(!file.is_directory);
        assert_eq!(file.relative_path, "src/main.rs");

        // 重新读取根目录，目录应当排在前面
        let txt_file = service.create_file(&root, "readme.txt").unwrap();
        assert_eq!(txt_file.name, "readme.txt");

        let entries = service.read_directory(&root).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries[0].is_directory); // "src" 目录在先
        assert!(!entries[1].is_directory); // "readme.txt"

        // 重命名文件
        let (old_rel, new_rel) = service
            .rename_node(&PathBuf::from(&file.path), "index.rs")
            .unwrap();
        assert_eq!(old_rel, "src/main.rs");
        assert_eq!(new_rel, "src/index.rs");

        // 删除文件
        let deleted = service
            .delete_node(&root.join("src").join("index.rs"))
            .unwrap();
        assert_eq!(deleted, "src/index.rs");
    }

    #[test]
    fn search_and_cancellation() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("search_test");
        fs::create_dir_all(&root).unwrap();

        // 写入测试文件
        fs::write(
            root.join("a.txt"),
            "hello world\nlightedit rust\nsecond line",
        )
        .unwrap();
        fs::write(root.join("b.txt"), "LIGHTEDIT rocks\nother content").unwrap();
        fs::write(root.join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(root.join("ignored.txt"), "lightedit in ignored").unwrap();

        let manager = SearchManager::default();
        let token = manager.create_token("search-1");

        let query = SearchQuery {
            search_id: "search-1".into(),
            query: "lightedit".into(),
            is_case_sensitive: false,
            is_whole_word: false,
            is_regex: false,
            max_results: Some(100),
            include_ignored: false,
        };

        let mut collected = Vec::new();
        let count = WorkspaceSearcher::execute_search(&root, &query, token, |batch| {
            collected.extend(batch);
        })
        .unwrap();

        // 应当匹配 a.txt 的第 2 行，b.txt 的第 1 行；ignored.txt 应当被忽略
        assert_eq!(count, 2);
        assert_eq!(collected.len(), 2);

        // 测试取消机制
        let cancel_token = manager.create_token("search-2");
        cancel_token.store(true, Ordering::Relaxed); // 立即标记取消

        let mut canceled_collected = Vec::new();
        let count2 = WorkspaceSearcher::execute_search(&root, &query, cancel_token, |batch| {
            canceled_collected.extend(batch);
        })
        .unwrap();

        assert_eq!(count2, 0);
        assert!(canceled_collected.is_empty());
    }
}
