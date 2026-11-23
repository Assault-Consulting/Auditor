// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

//! Streaming the package's evidence bundle into the file the user chose (E-01).
//!
//! The same shape as the export (`export.rs`): this process asks the sidecar
//! for the bundle and writes it to the chosen file as it arrives, hashing on
//! the way, so a bundle of a hundred thousand records never passes through
//! the webview. The webview names a session, a range and a profile, never a
//! path, a URL or a token.
//!
//! A bundle is a tar (`pala-bundle/1`), not lines, so wholeness is checked
//! the way a binary body allows: the bytes written must be the response's
//! `Content-Length`. A shorter body was cut short, and the partial file is
//! removed — a file that looks like a bundle and is not one is worse than none.
//!
//! What the package said about the bundle — how many records, how many with
//! an inclusion proof, the head, whether the log holds together — travels in
//! `X-Bundle-*` headers and is passed back as the package said it. A bundle
//! of a damaged chain is still saved: that is evidence for inspection.
//!
//! Nothing here reads PALA-1 bytes or opens the tar (ADR-0001).

use crate::artifact::{self, SavedArtifact};
use crate::export::{body, error_detail, read_head, ERROR_BODY_LIMIT, READ_TIMEOUT};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::net::TcpStream;
use std::path::Path;

/// What the package said about the bundle it assembled. Every field is
/// optional: a header the sidecar did not send is not guessed.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct BundleFacts {
    pub format: Option<String>,
    pub records: Option<u64>,
    pub proven: Option<u64>,
    pub head: Option<String>,
    pub chain_ok: Option<bool>,
    pub consistent: Option<bool>,
    pub from_seq: Option<u64>,
    pub to_seq: Option<u64>,
}

/// The saved bundle, and what the package said about it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct BundledArtifact {
    #[serde(flatten)]
    pub saved: SavedArtifact,
    pub facts: BundleFacts,
}

/// `/session/<id>/bundle` with its query. The session id is checked by the
/// caller (`export::valid_session_id`); a profile name is percent-encoded
/// here byte by byte, so nothing it holds can end the request line.
pub fn bundle_target(
    session_id: &str,
    from_seq: Option<u64>,
    to_seq: Option<u64>,
    profile: &str,
) -> String {
    let mut target = format!("/session/{session_id}/bundle?profile=");
    for b in profile.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            target.push(b as char);
        } else {
            target.push_str(&format!("%{b:02X}"));
        }
    }
    if let Some(from) = from_seq {
        target.push_str(&format!("&from_seq={from}"));
    }
    if let Some(to) = to_seq {
        target.push_str(&format!("&to_seq={to}"));
    }
    target
}

/// Fetch `target` and write the tar to `dest`, then its SHA-256 beside it.
/// On any failure the partial file is removed.
pub fn fetch_bundle(
    port: u16,
    token: &str,
    target: &str,
    dest: &Path,
) -> io::Result<BundledArtifact> {
    let result = stream(port, token, target, dest);
    if result.is_err() {
        let _ = fs::remove_file(dest);
    }
    result
}

fn stream(port: u16, token: &str, target: &str, dest: &Path) -> io::Result<BundledArtifact> {
    let mut sock = TcpStream::connect(("127.0.0.1", port))?;
    sock.set_read_timeout(Some(READ_TIMEOUT))?;
    write!(
        sock,
        "GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    )?;
    sock.flush()?;

    let mut reader = BufReader::new(sock);
    let head = read_head(&mut reader)?;
    let mut content = body(reader, &head);
    if head.status != 200 {
        let mut text = Vec::new();
        content.take(ERROR_BODY_LIMIT).read_to_end(&mut text)?;
        return Err(io::Error::other(error_detail(head.status, &text)));
    }

    let mut out = BufWriter::new(File::create(dest)?);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    let mut written = 0u64;
    loop {
        let n = content.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        out.write_all(&buf[..n])?;
        written += n as u64;
    }
    out.flush()?;
    out.get_ref().sync_all()?;
    drop(out);

    match head.length {
        Some(expected) if expected == written => {}
        Some(expected) => {
            return Err(io::Error::other(format!(
                "the bundle was cut short: {written} of {expected} bytes arrived"
            )))
        }
        None => {
            return Err(io::Error::other(
                "the sidecar sent no length, so a whole bundle cannot be told from a cut one",
            ))
        }
    }

    let streamed = format!("{:x}", hasher.finalize());
    let (on_disk, bytes) = artifact::sha256_of_file(dest)?;
    if on_disk != streamed {
        return Err(io::Error::other(
            "the file on disk does not match what was written",
        ));
    }
    let digest_path = artifact::write_digest(dest, &on_disk)?;

    let num = |name: &str| head.get(name).and_then(|v| v.parse::<u64>().ok());
    let flag = |name: &str| match head.get(name) {
        Some("true") => Some(true),
        Some("false") => Some(false),
        _ => None,
    };
    Ok(BundledArtifact {
        saved: SavedArtifact {
            path: dest.display().to_string(),
            digest_path: digest_path.display().to_string(),
            sha256: on_disk,
            bytes,
        },
        facts: BundleFacts {
            format: head.get("x-bundle-format").map(str::to_owned),
            records: num("x-bundle-records"),
            proven: num("x-bundle-proven"),
            head: head.get("x-bundle-head").map(str::to_owned),
            chain_ok: flag("x-bundle-chain-ok"),
            consistent: flag("x-bundle-consistent"),
            from_seq: num("x-bundle-from-seq"),
            to_seq: num("x-bundle-to-seq"),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::thread;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("auditor-bundle-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch directory");
        dir
    }

    fn serve(response: Vec<u8>) -> (u16, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let handle = thread::spawn(move || {
            let (mut sock, _) = listener.accept().expect("accept");
            let mut reader = BufReader::new(sock.try_clone().expect("clone"));
            let mut request = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).expect("request line");
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                request.push_str(&line);
            }
            sock.write_all(&response).expect("respond");
            request
        });
        (port, handle)
    }

    const TAR: &[u8] = b"not really a tar, but bytes the shell never opens\x00\x01\x02";

    fn response(body: &[u8], length: usize) -> Vec<u8> {
        let mut out = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/x-tar\r\ncontent-length: {length}\r\n\
             x-bundle-format: pala-bundle/1\r\nx-bundle-records: 3\r\nx-bundle-proven: 2\r\n\
             x-bundle-head: abcd\r\nx-bundle-chain-ok: true\r\nx-bundle-consistent: false\r\n\
             x-bundle-from-seq: 1\r\nx-bundle-to-seq: 3\r\nconnection: close\r\n\r\n"
        )
        .into_bytes();
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn a_bundle_lands_whole_with_its_digest_and_the_package_s_facts() {
        let dir = scratch("whole");
        let dest = dir.join("chain.bundle.tar");
        let (port, server) = serve(response(TAR, TAR.len()));
        let got =
            fetch_bundle(port, "tok", "/session/s1/bundle?profile=none", &dest).expect("saved");
        assert_eq!(fs::read(&dest).expect("file"), TAR);
        assert_eq!(got.saved.sha256, format!("{:x}", Sha256::digest(TAR)));
        assert_eq!(
            got.facts,
            BundleFacts {
                format: Some("pala-bundle/1".into()),
                records: Some(3),
                proven: Some(2),
                head: Some("abcd".into()),
                chain_ok: Some(true),
                consistent: Some(false),
                from_seq: Some(1),
                to_seq: Some(3),
            }
        );
        assert!(server
            .join()
            .expect("server")
            .starts_with("GET /session/s1/bundle?profile=none HTTP/1.1\r\n"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_bundle_cut_short_is_removed() {
        let dir = scratch("cut");
        let dest = dir.join("b.tar");
        let (port, server) = serve(response(&TAR[..10], TAR.len()));
        let err = fetch_bundle(port, "tok", "/x", &dest).expect_err("cut short");
        assert!(err.to_string().contains("cut short"));
        assert!(!dest.exists());
        server.join().expect("server");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_sidecar_s_refusal_is_said_in_its_words() {
        let dir = scratch("refused");
        let dest = dir.join("b.tar");
        let body = br#"{"detail":"a bundle selects at most 100,000 records"}"#;
        let mut resp = format!(
            "HTTP/1.1 422 Unprocessable Entity\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        resp.extend_from_slice(body);
        let (port, server) = serve(resp);
        let err = fetch_bundle(port, "tok", "/x", &dest).expect_err("refused");
        assert_eq!(err.to_string(), "a bundle selects at most 100,000 records");
        assert!(!dest.exists());
        server.join().expect("server");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_profile_name_cannot_end_the_request_line() {
        let t = bundle_target("s1", Some(2), None, "a b\r\nX: y");
        assert_eq!(
            t,
            "/session/s1/bundle?profile=a%20b%0D%0AX%3A%20y&from_seq=2"
        );
    }
}
