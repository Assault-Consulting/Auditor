// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

//! Tauri 2 shell.
//!
//! Owns OS concerns and the sidecar's lifetime. It does not own audit data:
//! the shell never opens a `.pala` container, it passes a path to the sidecar,
//! which reaches PALA-1 data only through `auditor_sidecar.pala_seam`
//! (ADR-0001). A Rust command that reads a container to check its size is
//! exactly the kind of small, reasonable helper that ADR exists to prevent.

mod artifact;
mod bundle;
mod export;
mod print;
mod sidecar;

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use tauri::webview::PageLoadEvent;
use tauri::{Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
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
///
/// `async`, so the body runs on the async runtime: a synchronous command
/// runs on the main thread, and the plugin's blocking dialog calls must not
/// — its documentation says they freeze the application there. Found while
/// building `save_artifact` (D-07); the open dialog had the same shape.
#[tauri::command(async)]
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

/// Ask for a segment set's manifest (§22.1): `pala-segments/1`, which a
/// rotating writer names `<base>.segments.json` and `segment_chain` names
/// `segments.json`. The same boundary as `pick_chain_file`: the dialog runs
/// here and only the chosen path crosses to the webview.
#[tauri::command(async)]
fn pick_segment_manifest(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("PALA segment set (segments.json)", &["json"])
        .add_filter("All files", &["*"])
        .blocking_pick_file()
        .map(|chosen| chosen.to_string())
}

/// Save one of this application's own artifacts where the user chooses (D-07).
///
/// The same boundary as `pick_chain_file`, for writing. The dialog runs in
/// this process and the file is written here, to the path the user just
/// chose in that dialog — the webview hands over only a suggested name and
/// the text, and never names a path to write to. So no filesystem
/// permission is granted to the webview, and `capabilities/default.json` is
/// unchanged: a webview that misbehaved could still not write anywhere the
/// user did not pick.
///
/// What is written is an artifact Auditor produced (a report, an export),
/// never a container: Auditor does not write PALA-1 bytes (§1.1). Beside it
/// goes its SHA-256 as `<name>.sha256`, in `sha256sum`'s own format, so the
/// digest travels with the file and a recipient can check it without us.
///
/// `Ok(None)` is a cancelled dialog, not an error.
#[tauri::command(async)]
fn save_artifact(
    app: tauri::AppHandle,
    suggested_name: String,
    contents: String,
) -> Result<Option<artifact::SavedArtifact>, String> {
    let mut dialog = app.dialog().file().set_file_name(&suggested_name);
    if let Some(ext) = Path::new(&suggested_name)
        .extension()
        .and_then(|e| e.to_str())
    {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    let Some(chosen) = dialog.add_filter("All files", &["*"]).blocking_save_file() else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    artifact::write_with_digest(&path, contents.as_bytes())
        .map(Some)
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// Export the package's record view of an open chain to a file the user
/// chooses (D-06).
///
/// The export is streamed: this process asks the sidecar for it and writes
/// each piece to the chosen file as it arrives (`export.rs`), so a
/// 770 MB export of a 1M-record chain never sits in memory — nor in the
/// webview, which a report's text does pass through. The webview names a
/// session and a range; the path comes from the dialog here, and the port
/// and token are this process's own. Beside the file goes its SHA-256, as
/// for any artifact (D-07), and back to the webview goes what the export's
/// own summary says about the file — whether it is consistent, and why not.
/// A file that is not consistent is still exported: that is a finding to
/// show, not a reason to refuse.
///
/// `Ok(None)` is a cancelled dialog, not an error.
#[tauri::command(async)]
fn export_records(
    app: tauri::AppHandle,
    supervisor: State<'_, Supervisor>,
    session_id: String,
    from_seq: Option<u64>,
    to_seq: Option<u64>,
    suggested_name: String,
) -> Result<Option<export::ExportedArtifact>, String> {
    if !export::valid_session_id(&session_id) {
        return Err("not a session id".to_owned());
    }
    let Some(chosen) = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("JSON Lines", &["jsonl"])
        .add_filter("All files", &["*"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    let session = supervisor.session();
    let target = export::export_target(&session_id, from_seq, to_seq);
    export::fetch_to_file(session.port, &session.token, &target, &path)
        .map(Some)
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// Save an evidence bundle of a selection of an open chain where the user
/// chooses (E-01).
///
/// Streamed like the export: the dialog runs here, this process asks the
/// sidecar for the bundle and writes it as it arrives (`bundle.rs`), with
/// its SHA-256 beside it. The webview names a session, a range and an anchor
/// profile — never a path. Back goes what the package said about the bundle.
/// A bundle of a damaged chain is saved too: the verification inside says so.
///
/// `Ok(None)` is a cancelled dialog, not an error.
#[tauri::command(async)]
fn save_bundle(
    app: tauri::AppHandle,
    supervisor: State<'_, Supervisor>,
    session_id: String,
    from_seq: Option<u64>,
    to_seq: Option<u64>,
    profile: String,
    suggested_name: String,
) -> Result<Option<bundle::BundledArtifact>, String> {
    if !export::valid_session_id(&session_id) {
        return Err("not a session id".to_owned());
    }
    let Some(chosen) = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("PALA evidence bundle", &["tar"])
        .add_filter("All files", &["*"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    let session = supervisor.session();
    let target = bundle::bundle_target(&session_id, from_seq, to_seq, &profile);
    bundle::fetch_bundle(session.port, &session.token, &target, &path)
        .map(Some)
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// Ask for a prefix-consistency proof someone holds (E-07):
/// `pala-consistency-proof/1`, JSON. The same boundary as `pick_chain_file`.
#[tauri::command(async)]
fn pick_consistency_proof(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("PALA consistency proof", &["json"])
        .add_filter("All files", &["*"])
        .blocking_pick_file()
        .map(|chosen| chosen.to_string())
}

/// Each print window gets a label of its own: closing one is asynchronous,
/// and reusing the label of a window still closing fails the build.
static PRINT_WINDOWS: AtomicU32 = AtomicU32::new(0);

/// Print the package's HTML report (D-02).
///
/// The page opens in a window of its own, from a `data:` URL — an opaque
/// origin with the app's CSP written in, and a window no capability names, so
/// the page reaches nothing (print.rs). Once it has loaded, the window asks
/// the operating system to print it, once; saving as PDF is that dialog's
/// offer. The window stays open after, showing what was printed, until the
/// user closes it.
#[tauri::command(async)]
fn print_report(app: tauri::AppHandle, html: String) -> Result<(), String> {
    let url = print::data_url(&html)?
        .parse::<tauri::Url>()
        .map_err(|e| e.to_string())?;
    let label = format!(
        "report-print-{}",
        PRINT_WINDOWS.fetch_add(1, Ordering::Relaxed)
    );
    let asked = Arc::new(AtomicBool::new(false));
    WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
        .title("Verification report — print")
        .inner_size(860.0, 1000.0)
        .on_page_load(move |window, payload| {
            if payload.event() == PageLoadEvent::Finished && !asked.swap(true, Ordering::SeqCst) {
                if let Err(e) = window.print() {
                    eprintln!("auditor: the print dialog did not open: {e}");
                }
            }
        })
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
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
        .invoke_handler(tauri::generate_handler![
            sidecar_session,
            pick_chain_file,
            pick_segment_manifest,
            save_artifact,
            export_records,
            save_bundle,
            pick_consistency_proof,
            print_report
        ])
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
