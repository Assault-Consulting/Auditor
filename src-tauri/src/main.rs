// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

// Keep the console window off on Windows release builds; a forensic tool
// that opens a stray terminal looks broken to the people who use it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    palimpsests_auditor_lib::run()
}
