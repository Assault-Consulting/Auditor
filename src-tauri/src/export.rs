// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

//! Streaming the package's record export into the file the user chose (D-06).
//!
//! The export (`pala-jsonl/1`, written by the package's `export_jsonl`) runs to
//! about 770 MB for a 1M-record chain, so it cannot travel the way a report
//! does — as a string from the webview. Instead this process, which already
//! holds the sidecar's port and token, asks the sidecar for the export itself
//! and writes the response to the chosen file as it arrives, hashing it on
//! the way. Memory stays at a buffer's worth whatever the chain's size.
//!
//! The boundary is the one `pick_chain_file` and `save_artifact` keep: the
//! webview names a session and a range, never a path, a URL or a token. The
//! session id is checked here before it goes anywhere near a request line.
//!
//! Nothing here reads PALA-1 bytes (ADR-0001). What it checks is that the
//! *transfer* is whole: the export's last line is its summary, so a stream
//! that ends anywhere else was cut short, and the partial file is removed
//! rather than left to look like an export.
//!
//! No HTTP library: the request is one GET to loopback, and the response is
//! read by hand — status, headers, then a body framed either by chunked
//! transfer coding (RFC 9112 §7.1, which uvicorn uses) or by the connection
//! closing. A dependency for that would be more code to trust than this.

use crate::artifact::{self, SavedArtifact};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, BufWriter, Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;

/// How long a read may wait for the next bytes. The export's summary needs a
/// full walk of the container first — about 14 s at 1M records — so this is
/// generous; it bounds a sidecar that has stopped answering, not a slow one.
const READ_TIMEOUT: Duration = Duration::from_secs(600);

/// Most bytes read of an error body. An error is a sentence, not a stream.
const ERROR_BODY_LIMIT: u64 = 64 * 1024;

/// A session id as the sidecar issues them: letters, digits, `-` and `_`.
///
/// Checked before it is put into a request line, so a webview that sent
/// anything else — a path, a second request, a query — is refused here.
pub fn valid_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The request target for an export of `session_id`, bounded or not.
pub fn export_target(session_id: &str, from_seq: Option<u64>, to_seq: Option<u64>) -> String {
    let mut target = format!("/session/{session_id}/export");
    let mut sep = '?';
    if let Some(from) = from_seq {
        target.push_str(&format!("{sep}from_seq={from}"));
        sep = '&';
    }
    if let Some(to) = to_seq {
        target.push_str(&format!("{sep}to_seq={to}"));
    }
    target
}

/// A body framed by chunked transfer coding, read as plain bytes.
struct Chunked<R> {
    inner: R,
    remaining: u64,
    done: bool,
}

impl<R: BufRead> Chunked<R> {
    fn new(inner: R) -> Self {
        Chunked {
            inner,
            remaining: 0,
            done: false,
        }
    }

    fn next_chunk(&mut self) -> io::Result<()> {
        let mut line = String::new();
        if self.inner.read_line(&mut line)? == 0 {
            return Err(cut_short());
        }
        let size = line.trim_end().split(';').next().unwrap_or("").trim();
        let size = u64::from_str_radix(size, 16)
            .map_err(|_| io::Error::other(format!("a chunk size that is not hex: {size:?}")))?;
        if size == 0 {
            // Trailers, if any, then the blank line that ends the body.
            loop {
                let mut trailer = String::new();
                if self.inner.read_line(&mut trailer)? == 0 || trailer.trim_end().is_empty() {
                    break;
                }
            }
            self.done = true;
        }
        self.remaining = size;
        Ok(())
    }
}

impl<R: BufRead> Read for Chunked<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.done || buf.is_empty() {
            return Ok(0);
        }
        if self.remaining == 0 {
            self.next_chunk()?;
            if self.done {
                return Ok(0);
            }
        }
        let want = buf.len().min(self.remaining as usize);
        let n = self.inner.read(&mut buf[..want])?;
        if n == 0 {
            return Err(cut_short());
        }
        self.remaining -= n as u64;
        if self.remaining == 0 {
            let mut crlf = Vec::with_capacity(2);
            (&mut self.inner).take(2).read_to_end(&mut crlf)?;
            if crlf.len() < 2 {
                return Err(cut_short());
            }
            if crlf != b"\r\n" {
                return Err(io::Error::other("a chunk not followed by CRLF"));
            }
        }
        Ok(n)
    }
}

fn cut_short() -> io::Error {
    io::Error::new(
        io::ErrorKind::UnexpectedEof,
        "the sidecar closed the connection before the export ended",
    )
}

/// The status and the framing of a response, read off its head.
struct Head {
    status: u16,
    chunked: bool,
    length: Option<u64>,
}

fn read_head<R: BufRead>(reader: &mut R) -> io::Result<Head> {
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let status = line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| {
            io::Error::other(format!("not an HTTP status line: {:?}", line.trim_end()))
        })?;
    let mut head = Head {
        status,
        chunked: false,
        length: None,
    };
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 {
            return Err(cut_short());
        }
        let header = header.trim_end();
        if header.is_empty() {
            return Ok(head);
        }
        if let Some((name, value)) = header.split_once(':') {
            let value = value.trim();
            match name.trim().to_ascii_lowercase().as_str() {
                "transfer-encoding" => {
                    head.chunked = value.to_ascii_lowercase().contains("chunked");
                }
                "content-length" => head.length = value.parse().ok(),
                _ => {}
            }
        }
    }
}

/// The body as plain bytes, whichever framing the response used.
fn body<'a, R: BufRead + 'a>(reader: R, head: &Head) -> Box<dyn Read + 'a> {
    if head.chunked {
        Box::new(Chunked::new(reader))
    } else if let Some(length) = head.length {
        Box::new(reader.take(length))
    } else {
        Box::new(reader)
    }
}

/// The sidecar's own sentence from an error body, or the status when it gave none.
fn error_detail(status: u16, body: &[u8]) -> String {
    let detail = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("detail").and_then(|d| d.as_str()).map(str::to_owned));
    match detail {
        Some(d) => d,
        None => format!("the sidecar answered HTTP {status}"),
    }
}

/// Fetch `target` from the sidecar on loopback and write the body to `dest`,
/// then its SHA-256 beside it.
///
/// On any failure the partial file is removed: a file that looks like an
/// export and is not one is worse than no file.
pub fn fetch_to_file(
    port: u16,
    token: &str,
    target: &str,
    dest: &Path,
) -> io::Result<SavedArtifact> {
    let result = stream_to_file(port, token, target, dest);
    if result.is_err() {
        let _ = fs::remove_file(dest);
    }
    result
}

fn stream_to_file(port: u16, token: &str, target: &str, dest: &Path) -> io::Result<SavedArtifact> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))?;
    stream.set_read_timeout(Some(READ_TIMEOUT))?;
    write!(
        stream,
        "GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    )?;
    stream.flush()?;

    let mut reader = BufReader::new(stream);
    let head = read_head(&mut reader)?;
    let mut body = body(reader, &head);

    if head.status != 200 {
        let mut text = Vec::new();
        body.take(ERROR_BODY_LIMIT).read_to_end(&mut text)?;
        return Err(io::Error::other(error_detail(head.status, &text)));
    }

    let mut out = BufWriter::new(File::create(dest)?);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    // The last complete line, and the one being read. The export ends with
    // its summary line, so that is what the last complete line must be.
    let mut last_line: Vec<u8> = Vec::new();
    let mut current: Vec<u8> = Vec::new();
    loop {
        let n = body.read(&mut buf)?;
        if n == 0 {
            break;
        }
        let piece = &buf[..n];
        hasher.update(piece);
        out.write_all(piece)?;
        for segment in piece.split_inclusive(|&b| b == b'\n') {
            if segment.last() == Some(&b'\n') {
                current.extend_from_slice(&segment[..segment.len() - 1]);
                last_line = std::mem::take(&mut current);
            } else {
                current.extend_from_slice(segment);
            }
        }
    }
    out.flush()?;
    out.get_ref().sync_all()?;
    drop(out);

    let is_summary = current.is_empty()
        && serde_json::from_slice::<serde_json::Value>(&last_line)
            .ok()
            .and_then(|v| v.get("summary").and_then(|s| s.as_bool()))
            == Some(true);
    if !is_summary {
        return Err(io::Error::other(
            "the export was cut short: its last line is not the summary",
        ));
    }

    // What the digest vouches for is the file as it now reads back, the same
    // rule D-07 keeps for a report.
    let streamed = format!("{:x}", hasher.finalize());
    let (on_disk, bytes) = artifact::sha256_of_file(dest)?;
    if on_disk != streamed {
        return Err(io::Error::other(
            "the file on disk does not match what was written",
        ));
    }
    let digest_path = artifact::write_digest(dest, &on_disk)?;
    Ok(SavedArtifact {
        path: dest.display().to_string(),
        digest_path: digest_path.display().to_string(),
        sha256: on_disk,
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::thread;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("auditor-export-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch directory");
        dir
    }

    /// A one-shot server: answers the first request with `response`, and
    /// hands back what it was asked.
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

    fn chunked(body: &[u8], piece: usize) -> Vec<u8> {
        let mut out = b"HTTP/1.1 200 OK\r\ncontent-type: application/x-ndjson\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n".to_vec();
        for part in body.chunks(piece) {
            out.extend_from_slice(format!("{:x}\r\n", part.len()).as_bytes());
            out.extend_from_slice(part);
            out.extend_from_slice(b"\r\n");
        }
        out.extend_from_slice(b"0\r\n\r\n");
        out
    }

    const EXPORT: &[u8] = b"{\"seq\":0,\"record_hash\":\"aa\"}\n{\"seq\":1,\"record_hash\":\"bb\"}\n{\"summary\":true,\"format\":\"pala-jsonl/1\",\"records\":2}\n";

    #[test]
    fn a_chunked_export_lands_whole_with_its_digest() {
        let dir = scratch("chunked");
        let dest = dir.join("chain.pala.jsonl");
        // Pieces of 7 bytes, so chunk boundaries fall inside lines.
        let (port, server) = serve(chunked(EXPORT, 7));
        let saved = fetch_to_file(port, "tok", "/session/s1/export", &dest).expect("saved");
        assert_eq!(fs::read(&dest).expect("file"), EXPORT);
        assert_eq!(saved.sha256, format!("{:x}", Sha256::digest(EXPORT)));
        assert_eq!(saved.bytes, EXPORT.len() as u64);
        assert!(fs::read_to_string(&saved.digest_path)
            .expect("digest")
            .ends_with("  chain.pala.jsonl\n"));
        let request = server.join().expect("server");
        assert!(request.starts_with("GET /session/s1/export HTTP/1.1\r\n"));
        assert!(request.contains("Authorization: Bearer tok\r\n"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_body_framed_by_closing_the_connection_is_read_too() {
        let dir = scratch("close");
        let dest = dir.join("e.jsonl");
        let mut response =
            b"HTTP/1.0 200 OK\r\ncontent-type: application/x-ndjson\r\n\r\n".to_vec();
        response.extend_from_slice(EXPORT);
        let (port, server) = serve(response);
        fetch_to_file(port, "tok", "/x", &dest).expect("saved");
        assert_eq!(fs::read(&dest).expect("file"), EXPORT);
        server.join().expect("server");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_error_carries_the_sidecars_sentence_and_leaves_no_file() {
        let dir = scratch("error");
        let dest = dir.join("e.jsonl");
        let body = br#"{"detail":"chain.pala has changed since it was opened"}"#;
        let mut response = format!(
            "HTTP/1.1 409 Conflict\r\ncontent-length: {}\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(body);
        let (port, server) = serve(response);
        let err = fetch_to_file(port, "tok", "/x", &dest).expect_err("refused");
        assert_eq!(
            err.to_string(),
            "chain.pala has changed since it was opened"
        );
        assert!(!dest.exists());
        assert!(!artifact::digest_path_for(&dest).exists());
        server.join().expect("server");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_stream_that_ends_before_the_summary_is_removed() {
        let dir = scratch("short");
        let dest = dir.join("e.jsonl");
        // Whole chunks, a proper end — but no summary line: the export was
        // cut short upstream of the framing.
        let (port, server) = serve(chunked(b"{\"seq\":0}\n{\"seq\":1}\n", 64));
        let err = fetch_to_file(port, "tok", "/x", &dest).expect_err("cut short");
        assert!(err.to_string().contains("cut short"));
        assert!(!dest.exists());
        server.join().expect("server");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_connection_that_closes_mid_chunk_is_an_error_and_leaves_no_file() {
        let dir = scratch("midchunk");
        let dest = dir.join("e.jsonl");
        let mut response = chunked(EXPORT, 1 << 16);
        response.truncate(response.len() - 20);
        let (port, server) = serve(response);
        assert!(fetch_to_file(port, "tok", "/x", &dest).is_err());
        assert!(!dest.exists());
        server.join().expect("server");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn chunk_extensions_and_trailers_are_read_past() {
        let raw = b"5;name=value\r\nhello\r\n0\r\nx-trailer: 1\r\n\r\n";
        let mut out = String::new();
        Chunked::new(&raw[..])
            .read_to_string(&mut out)
            .expect("read");
        assert_eq!(out, "hello");
    }

    #[test]
    fn only_a_plain_session_id_reaches_a_request_line() {
        assert!(valid_session_id("3f2a9c_b-01"));
        for bad in [
            "",
            "a/b",
            "a b",
            "a?x=1",
            "a\r\nHost: x",
            "..",
            &"a".repeat(129),
        ] {
            assert!(!valid_session_id(bad), "{bad:?}");
        }
    }

    #[test]
    fn the_target_carries_only_the_bounds_given() {
        assert_eq!(export_target("s", None, None), "/session/s/export");
        assert_eq!(
            export_target("s", Some(3), None),
            "/session/s/export?from_seq=3"
        );
        assert_eq!(
            export_target("s", None, Some(9)),
            "/session/s/export?to_seq=9"
        );
        assert_eq!(
            export_target("s", Some(3), Some(9)),
            "/session/s/export?from_seq=3&to_seq=9"
        );
    }
}
