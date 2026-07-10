use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::Mutex;
use std::time::Duration;

use tauri::path::BaseDirectory;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const PORT: u16 = 7433;

/// Holds the server child ONLY when this app instance spawned it.
/// Attached (externally started) servers are never killed by the app.
struct Sidecar(Mutex<Option<CommandChild>>);

fn server_healthy(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_millis(800)));
    if s
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = String::new();
    let _ = s.read_to_string(&mut buf);
    buf.starts_with("HTTP/1.1 200") && buf.contains("\"ok\":true")
}

fn create_main_window(handle: &tauri::AppHandle) {
    let url: tauri::Url = format!("http://127.0.0.1:{PORT}").parse().unwrap();
    WebviewWindowBuilder::new(handle, "main", WebviewUrl::External(url))
        .title("duet")
        .inner_size(1440.0, 900.0)
        .build()
        .expect("failed to create duet window");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Attach to a running duet server, else spawn the bundled sidecar
            // (v1 per ROADMAP: node + staged server.js, no Rust PTY rewrite).
            if !server_healthy(PORT) {
                let server_js = app
                    .path()
                    .resolve("resources/server/server.js", BaseDirectory::Resource)?
                    .to_string_lossy()
                    .into_owned();
                let (mut rx, child) = app.shell().sidecar("node")?.args([server_js]).spawn()?;
                *app.state::<Sidecar>().0.lock().unwrap() = Some(child);
                // Drain sidecar events so the channel never backs up.
                tauri::async_runtime::spawn(async move { while rx.recv().await.is_some() {} });
            }

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for _ in 0..75 {
                    if server_healthy(PORT) {
                        let h = handle.clone();
                        let _ = handle.run_on_main_thread(move || create_main_window(&h));
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                eprintln!("duet: server not healthy on 127.0.0.1:{PORT} after 15s — giving up");
                handle.exit(1);
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(child) = handle.state::<Sidecar>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
