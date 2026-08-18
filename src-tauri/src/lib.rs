// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

//! Tauri 2 shell.
//!
//! Owns OS concerns and the sidecar's lifetime. It does not own audit data:
//! the shell never opens a `.pala` container, it passes a path to the sidecar,
//! which reaches PALA-1 data only through `auditor_sidecar.pala_seam`
//! (ADR-0001). A Rust command that reads a container to check its size is
//! exactly the kind of small, reasonable helper that ADR exists to prevent.

mod sidecar;

use tauri::{Manager, RunEvent, State};

use sidecar::{Session, Supervisor};

/// Hand the frontend the port and token for this launch.
///
/// This is the only route by which the frontend can learn the token, and the
/// reason there is no anonymous path to the sidecar (ADR-0002).
#[tauri::command]
fn sidecar_session(supervisor: State<'_, Supervisor>) -> Session {
    supervisor.session()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Spawned before the window exists, so the frontend never renders against
    // a session that has not been created. If this fails there is nothing
    // useful to show, and starting a window that can never reach a verifier
    // would be a worse answer than an error.
    let supervisor = Supervisor::spawn().expect("failed to start the sidecar");

    tauri::Builder::default()
        .manage(supervisor)
        .invoke_handler(tauri::generate_handler![sidecar_session])
        .build(tauri::generate_context!())
        .expect("error while building Palimpsests Auditor")
        .run(|app, event| {
            // Kill the child with the window. A sidecar that outlives its
            // window is a file-reading service left running with a token
            // nobody is watching.
            if let RunEvent::Exit = event {
                app.state::<Supervisor>().shutdown();
            }
        });
}
