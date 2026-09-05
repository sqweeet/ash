use crate::BackendState;

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::State;

#[derive(Default)]
pub struct ProcessState {
    pub cancels: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub pending_cancels: Arc<Mutex<HashSet<String>>>,
}

#[derive(Debug, Serialize)]
pub struct ProcessOutput {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub cancelled: bool,
}

fn process_work_dir(cwd: &str) -> std::path::PathBuf {
    let candidate = std::path::Path::new(cwd);
    if candidate.is_dir() {
        return candidate.to_path_buf();
    }
    dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."))
}

fn resolved_command(program: &str, args: &[String]) -> (String, Vec<String>) {
    #[cfg(not(windows))]
    {
        // The product is Windows-first and the agent deliberately calls its
        // one-shot tool `powershell.exe`. Keep that contract while making the
        // Linux/macOS development build useful when PowerShell is unavailable.
        if matches!(program.to_ascii_lowercase().as_str(), "powershell.exe" | "powershell" | "pwsh.exe")
            && which::which(program).is_err()
            && which::which("pwsh").is_err()
        {
            if let Some(command) = args
                .windows(2)
                .find(|pair| pair[0].eq_ignore_ascii_case("-command"))
                .map(|pair| pair[1].clone())
            {
                return (
                    which::which("bash")
                        .map(|path| path.to_string_lossy().into_owned())
                        .unwrap_or_else(|_| "sh".to_string()),
                    vec!["-lc".to_string(), command],
                );
            }
        }
        if program.eq_ignore_ascii_case("curl.exe") && which::which(program).is_err() {
            return ("curl".to_string(), args.to_vec());
        }
    }

    (program.to_string(), args.to_vec())
}

fn stop_process_tree(child: &mut Child) {
    let Some(pid) = child.id().checked_add(0) else { return };
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        let _ = child.kill();
    }
}

fn run_process(
    program: String,
    args: Vec<String>,
    cwd: String,
    timeout_ms: u64,
    cancelled: Arc<AtomicBool>,
) -> Result<ProcessOutput, String> {
    if program.is_empty() {
        return Err("program is required".to_string());
    }
    let timeout = if timeout_ms == 0 { 120_000 } else { timeout_ms };
    let (resolved, resolved_args) = resolved_command(&program, &args);
    let mut command = Command::new(resolved);
    command
        .args(resolved_args)
        .current_dir(process_work_dir(&cwd))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("start {program}: {error}"))?;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let stdout_thread = thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(ref mut stream) = stdout {
            let _ = stream.read_to_end(&mut bytes);
        }
        bytes
    });
    let stderr_thread = thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(ref mut stream) = stderr {
            let _ = stream.read_to_end(&mut bytes);
        }
        bytes
    });

    let deadline = Instant::now() + Duration::from_millis(timeout);
    let mut timed_out = false;
    let mut was_cancelled = false;
    let status = loop {
        if cancelled.load(Ordering::SeqCst) {
            was_cancelled = true;
            stop_process_tree(&mut child);
        } else if Instant::now() >= deadline {
            timed_out = true;
            stop_process_tree(&mut child);
        }

        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(error) => {
                stop_process_tree(&mut child);
                let _ = child.wait();
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err(format!("wait {program}: {error}"));
            }
        }
    };
    let stdout = stdout_thread.join().unwrap_or_default();
    let stderr = stderr_thread.join().unwrap_or_default();
    let code = status.and_then(|status| status.code());
    Ok(ProcessOutput {
        code,
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        timed_out,
        cancelled: was_cancelled,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn process_run(
    state: State<'_, BackendState>,
    id: String,
    program: String,
    args: Vec<String>,
    cwd: String,
    timeout_ms: u64,
) -> Result<ProcessOutput, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    let cancels = state.processes.cancels.clone();
    let pending = state.processes.pending_cancels.clone();
    {
        let mut pending_guard = pending.lock().map_err(|_| "process state poisoned")?;
        let cancelled_before_start = pending_guard.remove(&id);
        drop(pending_guard);
        if cancelled_before_start {
            cancel.store(true, Ordering::SeqCst);
        } else {
            cancels
                .lock()
                .map_err(|_| "process state poisoned")?
                .insert(id.clone(), cancel.clone());
        }
    }

    let result = tauri::async_runtime::spawn_blocking(move || {
        if cancel.load(Ordering::SeqCst) {
            return Ok(ProcessOutput {
                code: None,
                stdout: String::new(),
                stderr: String::new(),
                timed_out: false,
                cancelled: true,
            });
        }
        run_process(program, args, cwd, timeout_ms, cancel)
    })
    .await
    .map_err(|error| format!("process worker: {error}"))?;

    if let Ok(mut guard) = cancels.lock() {
        guard.remove(&id);
    }
    result
}

#[tauri::command(rename_all = "camelCase")]
pub fn process_cancel(state: State<'_, BackendState>, id: String) {
    if id.is_empty() {
        return;
    }
    if let Ok(guard) = state.processes.cancels.lock() {
        if let Some(cancel) = guard.get(&id) {
            cancel.store(true, Ordering::SeqCst);
            return;
        }
    }
    if let Ok(mut pending) = state.processes.pending_cancels.lock() {
        pending.insert(id.clone());
    }
    let pending = state.processes.pending_cancels.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(60));
        if let Ok(mut guard) = pending.lock() {
            guard.remove(&id);
        }
    });
}
