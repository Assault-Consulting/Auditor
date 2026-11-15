// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

//! Printing the package's HTML report (D-02).
//!
//! The page is the package's `render_html`, never rebuilt here. It is shown in
//! a window of its own, loaded from a `data:` URL: such a document has an
//! opaque origin, Tauri writes the application's Content Security Policy into
//! it, and no capability names the window — so the page reaches nothing, as in
//! the sandboxed frame of D-01b. The window asks the operating system to print
//! once the page has loaded; "save as PDF" is that dialog's to offer, which
//! every desktop this ships on does.
//!
//! This module is the part that can be tested without a window: the URL, and
//! the size above which it is refused.

/// The largest page, in bytes, printed this way. WebView2 does not navigate
/// to a `data:` URL over 2 MB, and base64 makes three bytes four; a page
/// larger than this is refused with a sentence pointing at "Save HTML…",
/// whose file any browser prints.
pub const PRINT_LIMIT: usize = 1_400_000;

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding (RFC 4648 §4).
pub fn base64(input: &[u8]) -> String {
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// The `data:` URL the print window loads, or the sentence saying why not.
pub fn data_url(html: &str) -> Result<String, String> {
    if html.is_empty() {
        return Err("there is no report page to print".to_owned());
    }
    if html.len() > PRINT_LIMIT {
        return Err(format!(
            "the report page is {} bytes, more than this window prints ({} bytes); \
             save it with \"Save HTML…\" and print it from a browser",
            html.len(),
            PRINT_LIMIT
        ));
    }
    Ok(format!(
        "data:text/html;charset=utf-8;base64,{}",
        base64(html.as_bytes())
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_rfc_vectors() {
        // RFC 4648 §10.
        for (plain, coded) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64(plain.as_bytes()), coded, "{plain:?}");
        }
    }

    #[test]
    fn base64_uses_the_whole_alphabet() {
        let all: Vec<u8> = (0..=255).collect();
        let coded = base64(&all);
        assert_eq!(coded.len(), 344);
        assert!(coded.starts_with("AAECAwQFBgcICQoL"));
        assert!(coded.ends_with("+fr7/P3+/w=="));
    }

    #[test]
    fn a_page_becomes_an_html_data_url() {
        let url = data_url("<p>é</p>").unwrap();
        assert_eq!(url, "data:text/html;charset=utf-8;base64,PHA+w6k8L3A+");
    }

    #[test]
    fn an_empty_page_is_refused() {
        assert!(data_url("").unwrap_err().contains("no report page"));
    }

    #[test]
    fn a_page_past_the_limit_is_refused_with_the_way_round() {
        let page = "x".repeat(PRINT_LIMIT + 1);
        let err = data_url(&page).unwrap_err();
        assert!(err.contains("Save HTML"), "{err}");
        assert!(data_url(&"x".repeat(PRINT_LIMIT)).is_ok());
    }

    #[test]
    fn the_limit_fits_webview2s_two_megabytes() {
        let prefix = "data:text/html;charset=utf-8;base64,".len();
        assert!(prefix + PRINT_LIMIT.div_ceil(3) * 4 < 2 * 1024 * 1024);
    }
}
