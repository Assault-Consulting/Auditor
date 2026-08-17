// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

//! Minimal Tauri 2 shell.
//!
//! Deliberately empty of behaviour. Sidecar lifecycle, the per-launch session
//! token handed to the frontend over IPC, and the air-gap capability switch
//! all land in A-06 — together, because they are one security decision and
//! splitting them would mean a window that can reach the sidecar before the
//! token gate is wired.
//!
//! Note for anyone extending this file: the shell never opens a `.pala`
//! container. It passes a path to the sidecar, which reaches PALA-1 data only
//! through `auditor_sidecar.pala_seam` (ADR-0001). A Rust command that reads
//! a container to check its size is exactly the kind of small, reasonable
//! helper the ADR exists to prevent.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Palimpsests Auditor");
}
