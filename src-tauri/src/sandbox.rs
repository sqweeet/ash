use crate::BackendState;

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Debug, Serialize)]
pub struct SandboxInfo {
    pub path: String,
    pub files: usize,
}

#[derive(Debug, Serialize)]
pub struct FileChange {
    pub path: String,
    pub status: String,
}

const ALWAYS_SKIP: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".turbo",
    ".cache",
    ".parcel-cache",
    "coverage",
    ".svelte-kit",
    ".nuxt",
    "__pycache__",
    ".venv",
    "venv",
    ".mypy_cache",
    ".pytest_cache",
    ".gradle",
    ".idea",
];

fn sandbox_home() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".ash").join("sandboxes"))
        .ok_or_else(|| "couldn't determine the user home directory".to_string())
}

fn canonical_dir(path: &str) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path).map_err(|error| format!("{path}: {error}"))?;
    if !path.is_dir() {
        return Err(format!("not a directory: {}", path.display()));
    }
    Ok(path)
}

fn path_inside(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root).is_ok()
}

fn same_path(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    return left.to_string_lossy().eq_ignore_ascii_case(&right.to_string_lossy());
    #[cfg(not(windows))]
    return left == right;
}

fn ignored_names(root: &Path) -> HashSet<String> {
    let mut names = HashSet::new();
    let Ok(contents) = fs::read_to_string(root.join(".gitignore")) else { return names };
    for raw in contents.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('!') {
            continue;
        }
        let name = line.trim_matches('/');
        if !name.is_empty() && !name.chars().any(|ch| matches!(ch, '\\' | '/' | '*' | '?' | '[')) {
            names.insert(name.to_string());
        }
    }
    names
}

fn should_skip(name: &str, ignored: &HashSet<String>) -> bool {
    ALWAYS_SKIP.contains(&name) || ignored.contains(name)
}

fn copy_tree(source: &Path, destination: &Path, ignored: &HashSet<String>) -> Result<usize, String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("create {}: {error}", destination.display()))?;
    let mut files = 0;
    for entry in fs::read_dir(source).map_err(|error| format!("read {}: {error}", source.display()))? {
        let entry = entry.map_err(|error| format!("read {}: {error}", source.display()))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if should_skip(&name, ignored) {
            continue;
        }
        let from = entry.path();
        let to = destination.join(&name);
        let file_type = entry
            .file_type()
            .map_err(|error| format!("stat {}: {error}", from.display()))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            files += copy_tree(&from, &to, ignored)?;
        } else if file_type.is_file() {
            fs::copy(&from, &to)
                .map_err(|error| format!("copy {}: {error}", from.display()))?;
            files += 1;
        }
    }
    Ok(files)
}

fn sandbox_dir(path: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(sandbox_home()?).map_err(|error| format!("sandbox storage: {error}"))?;
    let candidate = fs::canonicalize(path).map_err(|error| format!("sandbox {path}: {error}"))?;
    if same_path(&root, &candidate) || !path_inside(&root, &candidate) || !candidate.is_dir() {
        return Err("refusing a path outside Safe mode storage".to_string());
    }
    Ok(candidate)
}

fn relative_key(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn collect_files(root: &Path, ignored: &HashSet<String>) -> Result<HashMap<String, PathBuf>, String> {
    let mut files = HashMap::new();
    fn visit(
        root: &Path,
        directory: &Path,
        ignored: &HashSet<String>,
        files: &mut HashMap<String, PathBuf>,
    ) -> Result<(), String> {
        for entry in fs::read_dir(directory).map_err(|error| format!("read {}: {error}", directory.display()))? {
            let entry = entry.map_err(|error| format!("read {}: {error}", directory.display()))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if should_skip(&name, ignored) {
                continue;
            }
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|error| format!("stat {}: {error}", path.display()))?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                visit(root, &path, ignored, files)?;
            } else if file_type.is_file() {
                let relative = path
                    .strip_prefix(root)
                    .map_err(|_| format!("unsafe workspace path: {}", path.display()))?;
                files.insert(relative_key(relative), path);
            }
        }
        Ok(())
    }
    visit(root, root, ignored, &mut files)?;
    Ok(files)
}

fn safe_relative(path: &str) -> bool {
    let candidate = Path::new(path);
    if candidate.is_absolute() || path.is_empty() {
        return false;
    }
    !candidate.components().any(|component| {
        matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))
    })
}

fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if !safe_relative(relative) {
        return Err(format!("unsafe path: {relative}"));
    }
    let path = root.join(relative);
    if !path_inside(root, &path) {
        return Err(format!("unsafe path: {relative}"));
    }
    Ok(path)
}

fn reject_linked_path(root: &Path, path: &Path) -> Result<(), String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| format!("unsafe path: {}", path.display()))?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(part) = component else { continue };
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!("refusing a linked path: {}", path.display()))
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(format!("stat {}: {error}", current.display())),
        }
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn sandbox_copy(source: String) -> Result<SandboxInfo, String> {
    let project = canonical_dir(&source).map_err(|error| format!("safe mode can't read the workspace: {error}"))?;
    let home = canonical_dir(
        dirs::home_dir()
            .ok_or_else(|| "safe mode couldn't determine the user home directory".to_string())?
            .to_string_lossy()
            .as_ref(),
    )?;
    if same_path(&project, &home) {
        return Err("Safe mode can't sandbox your home directory — open a project folder".to_string());
    }
    if project.parent().is_none() {
        return Err("Safe mode can't sandbox a drive root — open a project folder".to_string());
    }

    let root = sandbox_home()?;
    let root_absolute = if root.exists() {
        fs::canonicalize(&root).map_err(|error| format!("sandbox storage: {error}"))?
    } else {
        root.clone()
    };
    if path_inside(&project, &root_absolute) {
        return Err("safe mode storage can't be inside the workspace".to_string());
    }
    fs::create_dir_all(&root).map_err(|error| format!("safe mode couldn't create its storage: {error}"))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("safe mode clock: {error}"))?
        .as_millis();
    let name = project
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("workspace");
    let destination = root.join(format!("{name}-{timestamp}-{}", uuid::Uuid::new_v4().simple()));
    let files = copy_tree(&project, &destination, &ignored_names(&project)).map_err(|error| {
        let _ = fs::remove_dir_all(&destination);
        format!("safe mode couldn't copy the workspace: {error}")
    })?;
    Ok(SandboxInfo {
        path: destination.to_string_lossy().into_owned(),
        files,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn sandbox_changes(sandbox: String, project: String) -> Result<Vec<FileChange>, String> {
    let sandbox_root = sandbox_dir(&sandbox)?;
    let project_root = canonical_dir(&project).map_err(|error| format!("couldn't read the original workspace: {error}"))?;
    let ignored = ignored_names(&project_root);
    let sandbox_files = collect_files(&sandbox_root, &ignored)?;
    let project_files = collect_files(&project_root, &ignored)?;
    let mut changes = Vec::new();

    for (relative, sandbox_path) in &sandbox_files {
        match project_files.get(relative) {
            None => changes.push(FileChange { path: relative.clone(), status: "added".to_string() }),
            Some(project_path) => {
                let left = fs::read(sandbox_path).unwrap_or_default();
                let right = fs::read(project_path).unwrap_or_default();
                if left != right {
                    changes.push(FileChange { path: relative.clone(), status: "modified".to_string() });
                }
            }
        }
    }
    for relative in project_files.keys() {
        if !sandbox_files.contains_key(relative) {
            changes.push(FileChange { path: relative.clone(), status: "deleted".to_string() });
        }
    }
    changes.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(changes)
}

#[tauri::command(rename_all = "camelCase")]
pub fn sandbox_merge(
    sandbox: String,
    project: String,
    files: Vec<String>,
) -> Result<usize, String> {
    let sandbox_root = sandbox_dir(&sandbox)?;
    let project_root = canonical_dir(&project).map_err(|error| format!("couldn't read the original workspace: {error}"))?;
    let mut applied = 0;
    for relative in files {
        let from = safe_join(&sandbox_root, &relative)?;
        let to = safe_join(&project_root, &relative)?;
        reject_linked_path(&sandbox_root, &from)?;
        reject_linked_path(&project_root, &to)?;
        match fs::symlink_metadata(&from) {
            Ok(metadata) if metadata.file_type().is_file() => {
                if let Some(parent) = to.parent() {
                    fs::create_dir_all(parent).map_err(|error| format!("create {}: {error}", parent.display()))?;
                }
                fs::copy(&from, &to).map_err(|error| format!("merge {relative}: {error}"))?;
                applied += 1;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match fs::symlink_metadata(&to) {
                    Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(&to),
                    Ok(_) => fs::remove_file(&to),
                    Err(remove_error) if remove_error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    Err(remove_error) => Err(remove_error),
                }
                .map_err(|error| format!("remove {relative}: {error}"))?;
                applied += 1;
            }
            Ok(_) => return Err(format!("refusing to merge a non-regular file: {relative}")),
            Err(error) => return Err(format!("stat {relative}: {error}")),
        }
    }
    Ok(applied)
}

#[tauri::command(rename_all = "camelCase")]
pub fn sandbox_remove(sandbox: String) -> Result<(), String> {
    let path = match sandbox_dir(&sandbox) {
        Ok(path) => path,
        Err(error) if error.contains("No such file") || error.contains("not found") => return Ok(()),
        Err(error) => return Err(error),
    };
    fs::remove_dir_all(&path).map_err(|error| format!("remove sandbox: {error}"))
}

// The command module owns no state, but keeping State in the signature is
// useful for Tauri's generated handler symmetry and lets this module evolve
// without changing the frontend contract.
#[allow(dead_code)]
fn _state_type_marker(_: State<'_, BackendState>) {}
