use crate::BackendState;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

pub struct PtyState {
    pub sessions: Arc<Mutex<HashMap<String, Arc<PtySession>>>>,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send>>,
    pid: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct ForegroundProcess {
    pub name: String,
    pub pid: u32,
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        for candidate in ["pwsh.exe", "powershell.exe", "cmd.exe"] {
            if which::which(candidate).is_ok() {
                return candidate.to_string();
            }
        }
        return "cmd.exe".to_string();
    }

    std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.is_empty())
        .or_else(|| which::which("zsh").ok().map(|path| path.to_string_lossy().into_owned()))
        .or_else(|| which::which("bash").ok().map(|path| path.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "sh".to_string())
}

fn valid_work_dir(cwd: Option<&str>) -> std::path::PathBuf {
    cwd.filter(|path| Path::new(path).is_dir())
        .map(std::path::PathBuf::from)
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

fn kill_session(session: &PtySession) {
    if let Ok(mut child) = session.child.lock() {
        let _ = child.kill();
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, BackendState>,
    id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    program: Option<String>,
    args: Option<Vec<String>>,
) -> Result<String, String> {
    let cols = cols.max(1);
    let rows = rows.max(1);
    let shell = program.filter(|program| !program.is_empty()).unwrap_or_else(default_shell);
    let args = args.unwrap_or_default();
    let mut command = CommandBuilder::new(shell);
    command.args(args);
    command.cwd(valid_work_dir(cwd.as_deref()));
    command.env("TERM", "xterm-256color");

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("open pty: {error}"))?;
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("spawn pty: {error}"))?;
    let pid = child.process_id();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("clone pty reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("open pty writer: {error}"))?;
    let session = Arc::new(PtySession {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
        pid,
    });

    let old = state
        .ptys
        .sessions
        .lock()
        .map_err(|_| "pty state poisoned")?
        .insert(id.clone(), session.clone());
    if let Some(old) = old {
        kill_session(&old);
    }

    let sessions = state.ptys.sessions.clone();
    let event_id = id.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(size) if size > 0 => {
                    let data = String::from_utf8_lossy(&buffer[..size]).into_owned();
                    let _ = app.emit("pty:data", serde_json::json!({"id": event_id, "data": data}));
                }
                Ok(_) => break,
                Err(_) => break,
            }
        }

        if let Ok(mut child) = session.child.lock() {
            let _ = child.wait();
        }
        let _ = app.emit("pty:exit", serde_json::json!({"id": event_id}));
        if let Ok(mut guard) = sessions.lock() {
            if guard
                .get(&event_id)
                .map(|current| Arc::ptr_eq(current, &session))
                .unwrap_or(false)
            {
                guard.remove(&event_id);
            }
        }
    });

    Ok(id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn pty_write(state: State<'_, BackendState>, id: String, data: String) -> Result<(), String> {
    let session = state
        .ptys
        .sessions
        .lock()
        .map_err(|_| "pty state poisoned")?
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("no pty {id}"))?;
    let mut writer = session.writer.lock().map_err(|_| "pty writer poisoned")?;
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|error| format!("write pty {id}: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn pty_resize(state: State<'_, BackendState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let session = state
        .ptys
        .sessions
        .lock()
        .map_err(|_| "pty state poisoned")?
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("no pty {id}"))?;
    let result = session
        .master
        .lock()
        .map_err(|_| "pty master poisoned")?
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("resize pty {id}: {error}"));
    result
}

#[tauri::command(rename_all = "camelCase")]
pub fn pty_kill(state: State<'_, BackendState>, id: String) -> Result<(), String> {
    let session = state
        .ptys
        .sessions
        .lock()
        .map_err(|_| "pty state poisoned")?
        .remove(&id);
    if let Some(session) = session {
        kill_session(&session);
    }
    Ok(())
}

fn process_name(pid: u32) -> String {
    #[cfg(target_os = "linux")]
    {
        if let Ok(name) = std::fs::read_to_string(format!("/proc/{pid}/comm")) {
            return name.trim().to_string();
        }
    }
    #[cfg(unix)]
    {
        if let Ok(output) = Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "comm="])
            .output()
        {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    #[cfg(windows)]
    {
        if let Ok(output) = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .output()
        {
            let line = String::from_utf8_lossy(&output.stdout);
            if let Some(name) = line.split(',').next() {
                return name.trim_matches('"').to_string();
            }
        }
    }
    String::new()
}

#[tauri::command(rename_all = "camelCase")]
pub fn pty_foreground_process(
    state: State<'_, BackendState>,
    id: String,
) -> Result<ForegroundProcess, String> {
    let session = state
        .ptys
        .sessions
        .lock()
        .map_err(|_| "pty state poisoned")?
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("no pty {id}"))?;
    let pid = session.pid.unwrap_or_default();
    Ok(ForegroundProcess {
        name: process_name(pid),
        pid,
    })
}
