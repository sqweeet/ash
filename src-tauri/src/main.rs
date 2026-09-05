#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod process;
mod pty;
mod sandbox;

use commands::*;
use process::{process_cancel, process_run, ProcessState};
use pty::{pty_foreground_process, pty_kill, pty_resize, pty_spawn, pty_write, PtyState};
use sandbox::{sandbox_changes, sandbox_copy, sandbox_merge, sandbox_remove};

#[derive(Default)]
pub struct BackendState {
    pub ptys: PtyState,
    pub processes: ProcessState,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BackendState::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            read_text,
            write_text,
            delete_path,
            create_file,
            create_dir,
            list_dir,
            home_dir,
            git_branch,
            git_status,
            git_diff_stat,
            detect_bins,
            resolve_bash,
            find_editors,
            ssh_hosts,
            open_in,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_foreground_process,
            process_run,
            process_cancel,
            check_update,
            download_update,
            apply_update,
            restart_app,
            sandbox_copy,
            sandbox_changes,
            sandbox_merge,
            sandbox_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ash");
}

fn main() {
    run();
}
