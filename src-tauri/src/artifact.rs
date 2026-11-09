// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

//! Saving an artifact this application produced (D-07).
//!
//! The only bytes Auditor writes are its own artifacts — a report today, an
//! export or a bundle later (FUNCTIONALITY.md §1.1). This module writes one,
//! and its SHA-256 beside it, to a path the caller already has: the save
//! dialog in `lib.rs` chooses it, in this process, so the webview never names
//! a path to write to.
//!
//! The digest is of the artifact file, the same kind of fact `digest.py`
//! records for a container — it identifies the bytes handed to someone else.
//! It is not a PALA-1 fact: nothing here reads, decodes or hashes a chain
//! (ADR-0001).

use sha2::{Digest, Sha256};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// What was written, and where. Returned to the webview, which shows it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct SavedArtifact {
    /// The artifact file, as written.
    pub path: String,
    /// The `.sha256` file beside it.
    pub digest_path: String,
    /// SHA-256 of the bytes on disk, lowercase hex.
    pub sha256: String,
    /// Size of the artifact file in bytes.
    pub bytes: u64,
}

/// `report.json` → `report.json.sha256`, in the same directory.
///
/// Appended, never substituted for the extension, so the digest file names
/// the artifact it belongs to in full.
pub fn digest_path_for(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".sha256");
    path.with_file_name(name)
}

/// Write `contents` to `path`, then its SHA-256 to `<path>.sha256`.
///
/// The digest line is `sha256sum`'s own format — the hash, two spaces, the
/// file's name — so a recipient can check the pair with `sha256sum -c` from
/// the directory they sit in, with no tool of ours.
///
/// The hash is taken from the file **as read back**, not from the buffer it
/// was written from: what the digest vouches for is what is on disk. A file
/// that reads back different from what was written is an error, and the
/// digest file is then not written at all.
pub fn write_with_digest(path: &Path, contents: &[u8]) -> io::Result<SavedArtifact> {
    fs::write(path, contents)?;
    let on_disk = fs::read(path)?;
    if on_disk != contents {
        return Err(io::Error::other(
            "the file on disk does not match what was written",
        ));
    }
    let sha256 = format!("{:x}", Sha256::digest(&on_disk));

    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let digest_path = digest_path_for(path);
    fs::write(&digest_path, format!("{sha256}  {file_name}\n"))?;

    Ok(SavedArtifact {
        path: path.display().to_string(),
        digest_path: digest_path.display().to_string(),
        sha256,
        bytes: on_disk.len() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("auditor-artifact-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch directory");
        dir
    }

    #[test]
    fn writes_the_artifact_and_its_digest_beside_it() {
        let dir = scratch("pair");
        let path = dir.join("chain.pala.report.json");
        let saved = write_with_digest(&path, b"abc").expect("saved");

        assert_eq!(fs::read(&path).expect("artifact"), b"abc");
        // SHA-256("abc"), the FIPS 180-2 test vector.
        let abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert_eq!(saved.sha256, abc);
        assert_eq!(saved.bytes, 3);
        assert_eq!(
            fs::read_to_string(&saved.digest_path).expect("digest file"),
            format!("{abc}  chain.pala.report.json\n")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_digest_file_names_the_artifact_in_full() {
        assert_eq!(
            digest_path_for(Path::new("/x/report.json")),
            PathBuf::from("/x/report.json.sha256")
        );
        assert_eq!(
            digest_path_for(Path::new("/x/no-extension")),
            PathBuf::from("/x/no-extension.sha256")
        );
    }

    #[test]
    fn saving_again_replaces_both_files() {
        let dir = scratch("again");
        let path = dir.join("r.json");
        write_with_digest(&path, b"first").expect("first");
        let second = write_with_digest(&path, b"second").expect("second");
        assert_eq!(fs::read(&path).expect("artifact"), b"second");
        let line = fs::read_to_string(&second.digest_path).expect("digest file");
        assert!(line.starts_with(&second.sha256));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unwritable_place_is_an_error_and_writes_no_digest() {
        let dir = scratch("missing");
        let path = dir.join("no-such-directory").join("r.json");
        assert!(write_with_digest(&path, b"x").is_err());
        assert!(!digest_path_for(&path).exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
