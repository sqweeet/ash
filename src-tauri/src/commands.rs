use futures_util::StreamExt;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRelease {
    pub has_update: bool,
    pub latest: String,
    pub current: String,
    pub notes: String,
    pub url: String,
    pub download_url: String,
    pub download_size: i64,
    pub asset_name: String,
}

#[derive(Debug, Serialize)]
pub struct DirItem {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[tauri::command(rename_all = "camelCase")]
pub fn app_info() -> HashMap<String, String> {
    HashMap::from([
        ("version".to_string(), env!("CARGO_PKG_VERSION").to_string()),
        (
            "commit".to_string(),
            option_env!("ASH_COMMIT").unwrap_or("none").to_string(),
        ),
        (
            "channel".to_string(),
            option_env!("ASH_BUILD_CHANNEL").unwrap_or("dev").to_string(),
        ),
    ])
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_text(path: String) -> Result<Option<String>, String> {
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("read {path}: {error}")),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn write_text(path: String, contents: String) -> Result<(), String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("create {}: {error}", parent.display()))?;
    }
    fs::write(target, contents).map_err(|error| format!("write {path}: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_path(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(target).map_err(|error| format!("stat {path}: {error}"))?;
    if metadata.is_dir() {
        fs::remove_dir_all(target)
    } else {
        fs::remove_file(target)
    }
    .map_err(|error| format!("delete {path}: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_file(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("create {}: {error}", parent.display()))?;
    }
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map(|_| ())
        .map_err(|error| format!("create file {path}: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|error| format!("create directory {path}: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_dir(path: String) -> Result<Vec<DirItem>, String> {
    let mut items = Vec::new();
    let entries = fs::read_dir(&path).map_err(|error| format!("list {path}: {error}"))?;
    for entry in entries.take(1000) {
        let entry = entry.map_err(|error| format!("list {path}: {error}"))?;
        let entry_path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|error| format!("stat {}: {error}", entry_path.display()))?;
        items.push(DirItem {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry_path.to_string_lossy().into_owned(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }
    items.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(items)
}

#[tauri::command(rename_all = "camelCase")]
pub fn home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .ok_or_else(|| "couldn't determine the user home directory".to_string())
}

fn git_run(dir: &str, args: &[&str]) -> String {
    if dir.is_empty() || !Path::new(dir).is_dir() {
        return String::new();
    }
    let output = Command::new("git").args(args).current_dir(dir).output();
    match output {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
        _ => String::new(),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn git_branch(path: String) -> String {
    git_run(&path, &["rev-parse", "--abbrev-ref", "HEAD"])
}

#[tauri::command(rename_all = "camelCase")]
pub fn git_status(path: String) -> String {
    git_run(&path, &["status", "--porcelain"])
}

#[tauri::command(rename_all = "camelCase")]
pub fn git_diff_stat(path: String) -> String {
    git_run(&path, &["diff", "--stat"])
}

#[tauri::command(rename_all = "camelCase")]
pub fn detect_bins(names: Vec<String>) -> Vec<String> {
    names
        .into_iter()
        .filter(|name| which::which(name).is_ok())
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
pub fn resolve_bash() -> String {
    #[cfg(windows)]
    {
        if let Ok(path) = std::env::var("PATH") {
            for directory in std::env::split_paths(&path) {
                let lower = directory.to_string_lossy().to_lowercase();
                if lower.contains("\\windows\\system32")
                    || lower.contains("\\windows\\syswow64")
                    || lower.contains("\\windows\\sysnative")
                    || lower.contains("\\microsoft\\windowsapps")
                {
                    continue;
                }
                let candidate = directory.join("bash.exe");
                if candidate.is_file() {
                    return candidate.to_string_lossy().into_owned();
                }
            }
        }
        return String::new();
    }

    which::which("bash")
        .or_else(|_| which::which("zsh"))
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[tauri::command(rename_all = "camelCase")]
pub fn find_editors() -> Vec<String> {
    [
        "code",
        "code-insiders",
        "cursor",
        "zed",
        "zed-dev",
        "windsurf",
        "trae",
        "clave",
    ]
    .into_iter()
    .filter(|name| which::which(name).is_ok())
    .map(str::to_string)
    .collect()
}

#[tauri::command(rename_all = "camelCase")]
pub fn ssh_hosts() -> Vec<String> {
    let Some(home) = dirs::home_dir() else { return Vec::new() };
    let config = home.join(".ssh").join("config");
    let Ok(contents) = fs::read_to_string(config) else { return Vec::new() };
    let mut hosts = Vec::new();
    for raw_line in contents.lines() {
        let line = raw_line.trim();
        let lower = line.to_lowercase();
        if !lower.starts_with("host ") {
            continue;
        }
        for host in line[5..].split_whitespace() {
            if !host.chars().any(|ch| matches!(ch, '*' | '?' | '!')) {
                hosts.push(host.to_string());
            }
        }
    }
    hosts.sort();
    hosts.dedup();
    hosts
}

#[tauri::command(rename_all = "camelCase")]
pub fn open_in(app: String, path: String, _is_dir: bool) -> Result<(), String> {
    #[cfg(windows)]
    let mut command = if app == "explorer" {
        let mut command = Command::new("explorer.exe");
        if _is_dir {
            command.arg(&path);
        } else {
            command.arg(format!("/select,{path}"));
        }
        command
    } else {
        let mut command = Command::new(&app);
        command.arg(&path);
        command
    };

    #[cfg(not(windows))]
    let mut command = if app == "explorer" {
        let opener = which::which("xdg-open")
            .or_else(|_| which::which("open"))
            .map_err(|_| "no system opener found".to_string())?;
        let mut command = Command::new(opener);
        command.arg(&path);
        command
    } else {
        let mut command = Command::new(&app);
        command.arg(&path);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("open {path}: {error}"))
}

const GH_OWNER: &str = "xn0tdev";
const GH_REPO: &str = "ash";
const RELEASE_ASSET: &str = "Ash.exe";

async fn fetch_latest_release() -> Result<UpdateRelease, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let url = format!("https://api.github.com/repos/{GH_OWNER}/{GH_REPO}/releases/latest");
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Ash updater")
        .build()
        .map_err(|error| format!("build update client: {error}"))?
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|error| format!("check update: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("github api: {}", response.status()));
    }

    #[derive(serde::Deserialize)]
    struct Release {
        tag_name: String,
        body: Option<String>,
        html_url: String,
        assets: Vec<Asset>,
    }
    #[derive(serde::Deserialize)]
    struct Asset {
        name: String,
        browser_download_url: String,
        size: i64,
    }

    let release: Release = response
        .json()
        .await
        .map_err(|error| format!("decode release: {error}"))?;
    let latest = release.tag_name.trim_start_matches('v').to_string();
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name == RELEASE_ASSET)
        .ok_or_else(|| format!("release {} has no {RELEASE_ASSET} asset", release.tag_name))?;

    let current_version = semver::Version::parse(&current).unwrap_or_else(|_| semver::Version::new(0, 0, 0));
    let latest_version = semver::Version::parse(&latest).unwrap_or_else(|_| semver::Version::new(0, 0, 0));
    Ok(UpdateRelease {
        has_update: latest_version > current_version,
        latest,
        current,
        notes: release.body.unwrap_or_default(),
        url: release.html_url,
        download_url: asset.browser_download_url,
        download_size: asset.size,
        asset_name: asset.name,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn check_update() -> Result<UpdateRelease, String> {
    fetch_latest_release().await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn download_update(app: AppHandle) -> Result<String, String> {
    let release = fetch_latest_release().await?;
    if !release.has_update {
        return Err("no update available".to_string());
    }

    let exe = std::env::current_exe().map_err(|error| format!("resolve exe: {error}"))?;
    let destination = if cfg!(windows) {
        exe.parent().unwrap_or_else(|| Path::new(".")).join("Ash.exe.new")
    } else {
        std::env::temp_dir().join("Ash.new")
    };
    let partial = destination.with_extension("part");
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .user_agent("Ash updater")
        .build()
        .map_err(|error| format!("build update client: {error}"))?
        .get(&release.download_url)
        .send()
        .await
        .map_err(|error| format!("download: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("download: {}", response.status()));
    }

    let total = response.content_length().unwrap_or(release.download_size.max(0) as u64);
    let mut stream = response.bytes_stream();
    let mut file = fs::File::create(&partial).map_err(|error| format!("create temp: {error}"))?;
    let mut written = 0_u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("download: {error}"))?;
        file.write_all(&chunk).map_err(|error| format!("write update: {error}"))?;
        written += chunk.len() as u64;
        let percent = if total == 0 { 0 } else { (written * 100 / total) as i32 };
        let _ = app.emit(
            "update:progress",
            json!({"percent": percent, "downloaded": written, "total": total, "stage": "downloading"}),
        );
    }
    file.flush().map_err(|error| format!("flush update: {error}"))?;
    drop(file);
    fs::rename(&partial, &destination).map_err(|error| format!("finalize download: {error}"))?;
    let _ = app.emit(
        "update:progress",
        json!({"percent": 100, "downloaded": written, "total": total, "stage": "downloaded"}),
    );
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command(rename_all = "camelCase")]
pub fn apply_update(app: AppHandle, path: String) -> Result<(), String> {
    let _ = app.emit("update:progress", json!({"stage": "installing", "percent": 100}));
    #[cfg(not(windows))]
    {
        let _ = path;
        return Err("self-update is only supported by the Windows release build".to_string());
    }

    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|error| format!("resolve exe: {error}"))?;
        let old = exe.with_extension("exe.old");
        let _ = fs::remove_file(&old);
        fs::rename(&exe, &old).map_err(|error| format!("prepare update: {error}"))?;
        if let Err(error) = fs::rename(&path, &exe) {
            let _ = fs::rename(&old, &exe);
            return Err(format!("install update: {error}"));
        }
        let _ = app.emit("update:progress", json!({"stage": "restarting", "percent": 100}));
        Command::new(&exe)
            .spawn()
            .map_err(|error| format!("relaunch: {error}"))?;
        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(600));
            std::process::exit(0);
        });
        Ok(())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn restart_app(app: AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|error| format!("resolve exe: {error}"))?;
    Command::new(exe)
        .spawn()
        .map_err(|error| format!("relaunch: {error}"))?;
    app.exit(0);
    Ok(())
}
