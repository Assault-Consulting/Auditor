// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

//! Sidecar lifecycle: pick a port, mint a token, spawn, and make sure the
//! child dies with the window.
//!
//! ADR-0002 puts the trust boundary on the bearer token. This module is where
//! that token comes into existence, so three things hold here or they hold
//! nowhere:
//!
//! * the token is generated from the OS CSPRNG, per launch, and never
//!   persisted;
//! * it reaches the sidecar through the environment and the frontend through
//!   IPC — never through a command line, which is world-readable in `ps` on
//!   every platform this ships to;
//! * the child is killed when the application exits, because a sidecar that
//!   outlives its window is a file-reading service left running with a token
//!   nobody is watching.

use std::io;
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use rand::distributions::Alphanumeric;
use rand::Rng;

/// Matches `DEFAULT_PORT` in `auditor_sidecar.main`. The sidecar falls back to
/// this when the environment does not name one; the shell almost always does.
const FIRST_PORT: u16 = 8771;

/// How many consecutive ports to try before giving up. Twenty is arbitrary and
/// generous: a machine with twenty consecutive ports occupied in this range has
/// a problem this application should report rather than route around forever.
const PORT_ATTEMPTS: u16 = 20;

/// Token length in characters. 43 alphanumerics is ~256 bits of entropy, the
/// same order as `secrets.token_urlsafe(32)` on the Python side.
const TOKEN_LEN: usize = 43;

/// Environment variable overriding the interpreter used to launch the sidecar.
/// Present for development against a virtualenv; packaging the sidecar as a
/// self-contained binary is a later change, and until it lands this
/// application requires Python on the host.
const PYTHON_ENV: &str = "AUDITOR_SIDECAR_PYTHON";

/// What the frontend needs in order to talk to the sidecar, and nothing else.
#[derive(Clone, serde::Serialize)]
pub struct Session {
    pub port: u16,
    pub token: String,
}

pub struct Supervisor {
    session: Session,
    child: Mutex<Option<Child>>,
}

impl Supervisor {
    /// Spawn the sidecar and return a handle that owns its lifetime.
    pub fn spawn() -> io::Result<Self> {
        let port = pick_port()?;
        let token = mint_token();

        let child = Command::new(interpreter())
            .args(["-m", "auditor_sidecar.main"])
            // The token goes in the environment, never in argv. Command lines
            // are readable by any process on the machine — `ps`, Task Manager,
            // Activity Monitor — which would hand the boundary to exactly the
            // local caller it exists to keep out.
            .env("AUDITOR_SIDECAR_TOKEN", &token)
            .env("AUDITOR_SIDECAR_PORT", port.to_string())
            .stdin(Stdio::null())
            // Inherited on purpose: the sidecar prints a warning when it starts
            // without a token, and swallowing that would hide the one message
            // that says a security control is off.
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()?;

        Ok(Self {
            session: Session { port, token },
            child: Mutex::new(Some(child)),
        })
    }

    pub fn session(&self) -> Session {
        self.session.clone()
    }

    /// Kill the child. Safe to call more than once.
    ///
    /// `kill` rather than a graceful signal: the sidecar holds no state worth
    /// flushing — it never writes to an audited container (ADR-0001) — and a
    /// polite shutdown that can hang is worse here than an abrupt one that
    /// cannot. Report artifacts are written and closed before their request
    /// returns.
    pub fn shutdown(&self) {
        let mut guard = match self.child.lock() {
            Ok(guard) => guard,
            // A poisoned mutex means another thread panicked while holding it.
            // Leaving the child alive would be the worse outcome, so recover
            // the guard and proceed.
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn interpreter() -> String {
    if let Ok(path) = std::env::var(PYTHON_ENV) {
        if !path.trim().is_empty() {
            return path;
        }
    }
    if cfg!(windows) {
        "python".into()
    } else {
        "python3".into()
    }
}

fn mint_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(TOKEN_LEN)
        .map(char::from)
        .collect()
}

/// Find a free loopback port by binding it and letting it go.
///
/// There is a race between releasing the listener and the sidecar binding: any
/// other process can take the port in between. It is accepted rather than
/// hidden, because the alternative — passing an inherited socket to a Python
/// child across three platforms — is a great deal of machinery for a window
/// measured in milliseconds on a single-user desktop. The failure is visible
/// and recoverable: the sidecar exits, the health probe never answers, and the
/// window reports that the service did not start.
fn pick_port() -> io::Result<u16> {
    for port in FIRST_PORT..FIRST_PORT.saturating_add(PORT_ATTEMPTS) {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AddrInUse,
        format!(
            "no free loopback port in {}..{}",
            FIRST_PORT,
            FIRST_PORT.saturating_add(PORT_ATTEMPTS)
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_unique_and_long_enough() {
        let a = mint_token();
        let b = mint_token();
        assert_ne!(a, b);
        assert_eq!(a.len(), TOKEN_LEN);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn a_picked_port_is_in_range() {
        let port = pick_port().expect("no free port in the test environment");
        assert!((FIRST_PORT..FIRST_PORT + PORT_ATTEMPTS).contains(&port));
    }

    #[test]
    fn interpreter_falls_back_to_a_platform_default() {
        // Not asserting the override here: std::env is process-global and
        // cargo runs tests in threads, so a test that mutates it can flip an
        // unrelated one. The fallback is the branch worth pinning anyway —
        // it is the one a user hits.
        std::env::remove_var(PYTHON_ENV);
        let interp = interpreter();
        assert!(interp == "python3" || interp == "python");
    }
}
