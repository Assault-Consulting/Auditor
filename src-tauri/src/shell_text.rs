// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

//! The few words this process shows itself, in the language the window chose
//! (L-05).
//!
//! The native dialogs' filter names and the print window's title are drawn
//! by the operating system on this side. Their translations live where every
//! other one does, in the webview's catalogs, and the webview sends them here
//! when the language is chosen or changed. This file keeps no catalog of its
//! own, so a new language still touches no code.
//!
//! What crosses is text to show, nothing else. Each value is checked:
//! - it is a known name;
//! - it is short (a label, not a document);
//! - it has no control characters, so no line breaks either.
//!
//! Anything else is refused whole, and the English already held stays in
//! use. Until the webview has spoken, English is shown.

use std::collections::HashMap;

/// Longest text accepted for one label, in characters.
pub const MAX_LABEL: usize = 120;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellText {
    pub chain: String,
    pub segment_set: String,
    pub all_files: String,
    pub json_lines: String,
    pub bundle: String,
    pub consistency_proof: String,
    pub signed_statement: String,
    pub public_key: String,
    pub anchor_file: String,
    pub pkcs11_module: String,
    pub print_title: String,
}

impl Default for ShellText {
    fn default() -> Self {
        Self {
            chain: "PALA-1 audit chain".into(),
            segment_set: "PALA segment set (segments.json)".into(),
            all_files: "All files".into(),
            json_lines: "JSON Lines".into(),
            bundle: "PALA evidence bundle".into(),
            consistency_proof: "PALA consistency proof".into(),
            signed_statement: "SCITT signed statement".into(),
            public_key: "Public key".into(),
            anchor_file: "Anchor head file".into(),
            pkcs11_module: "PKCS#11 module".into(),
            print_title: "Verification report — print".into(),
        }
    }
}

impl ShellText {
    /// Build from what the webview sent: every name, each value checked.
    /// A missing name keeps its English; an unknown one is refused.
    pub fn from_labels(labels: &HashMap<String, String>) -> Result<Self, String> {
        let mut out = Self::default();
        for (name, value) in labels {
            let count = value.chars().count();
            if count == 0 || count > MAX_LABEL {
                return Err(format!("{name}: a label of {count} characters"));
            }
            if value.chars().any(char::is_control) {
                return Err(format!("{name}: a control character in a label"));
            }
            let slot = match name.as_str() {
                "chain" => &mut out.chain,
                "segment_set" => &mut out.segment_set,
                "all_files" => &mut out.all_files,
                "json_lines" => &mut out.json_lines,
                "bundle" => &mut out.bundle,
                "consistency_proof" => &mut out.consistency_proof,
                "signed_statement" => &mut out.signed_statement,
                "public_key" => &mut out.public_key,
                "anchor_file" => &mut out.anchor_file,
                "pkcs11_module" => &mut out.pkcs11_module,
                "print_title" => &mut out.print_title,
                _ => return Err(format!("{name}: not a label this shell shows")),
            };
            *slot = value.clone();
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[test]
    fn a_language_replaces_what_it_names_and_keeps_english_for_the_rest() {
        let got = ShellText::from_labels(&labels(&[
            ("all_files", "Усі файли"),
            ("print_title", "Звіт про перевірку — друк"),
        ]))
        .expect("accepted");
        assert_eq!(got.all_files, "Усі файли");
        assert_eq!(got.print_title, "Звіт про перевірку — друк");
        assert_eq!(got.chain, ShellText::default().chain);
    }

    #[test]
    fn an_unknown_name_is_refused() {
        let err = ShellText::from_labels(&labels(&[("path", "/etc/passwd")])).expect_err("refused");
        assert!(err.contains("not a label"));
    }

    #[test]
    fn a_line_break_or_an_empty_or_a_long_label_is_refused() {
        assert!(ShellText::from_labels(&labels(&[("chain", "a\nb")])).is_err());
        assert!(ShellText::from_labels(&labels(&[("chain", "")])).is_err());
        let long = "я".repeat(MAX_LABEL + 1);
        assert!(ShellText::from_labels(&labels(&[("chain", &long)])).is_err());
        let fits = "я".repeat(MAX_LABEL);
        assert!(ShellText::from_labels(&labels(&[("chain", &fits)])).is_ok());
    }
}
