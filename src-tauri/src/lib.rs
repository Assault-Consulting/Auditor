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
use tauri_plugin_dialog::DialogExt;

use sidecar::{Session, Supervisor};

/// Hand the frontend the port and token for this launch.
///
/// This is the only route by which the frontend can learn the token, and the
/// reason there is no anonymous path to the sidecar (ADR-0002).
#[tauri::command]
fn sidecar_session(supervisor: State<'_, Supervisor>) -> Session {
    supervisor.session()
}

/// Ask the user for a container, and return **only its path**.
///
/// This exists instead of calling the dialog plugin from the frontend, and
/// the difference is a security boundary rather than a style preference.
///
/// The plugin's JavaScript `open()` states plainly that "the selected paths
/// are added to the filesystem and asset protocol scopes" — that is, calling
/// it would grant the webview the ability to read the chosen file's bytes.
/// For this application that is not a small extra: reading container bytes
/// in the shell is precisely what ADR-0001 forbids, and it would arrive as a
/// *capability* rather than as code, so `check_no_wire_parsing.sh` would
/// never see it. The plugin's own documentation recommends the alternative
/// we take here: "prefer writing a dedicated command instead".
///
/// So the dialog runs in this process, and a `String` crosses to the
/// webview. The frontend hands that path to the sidecar, which opens it
/// through the seam. No new entry appears in `capabilities/default.json`.
///
/// `None` means the user cancelled, which is not an error and must not be
/// rendered as one.
#[tauri::command]
fn pick_chain_file(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        // Both filters, in this order. A `.pala` filter is the useful
        // default, but evidence does not always arrive with the extension it
        // ought to have — a container copied out of an incident bundle may
        // be named anything at all, and a picker that hides it would send
        // the operator to the shell to work around us.
        .add_filter("PALA-1 audit chain", &["pala"])
        .add_filter("All files", &["*"])
        .blocking_pick_file()
        .map(|chosen| chosen.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Spawned before the window exists, so the frontend never renders against
    // a session that has not been created. If this fails there is nothing
    // useful to show, and starting a window that can never reach a verifier
    // would be a worse answer than an error.
    let supervisor = Supervisor::spawn().expect("failed to start the sidecar");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(supervisor)
        .invoke_handler(tauri::generate_handler![sidecar_session, pick_chain_file])
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
