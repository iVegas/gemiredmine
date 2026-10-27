//! What this computer is already set up for, so the settings screen can offer a model instead of asking the user to
//! type an API key or an address. Only places that hold such a setting on purpose are read: a handful of environment
//! variables, and the configuration files of the command line tools of the same services.
//!
//! Nothing is written, and nothing is reported that was not found in one of those places.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// A key or an address found on this computer, as the webview reads it (`SystemAiSetup` in `src/shared/assistant.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAiSetup {
    /// The service the setting belongs to: one of the app's own provider names.
    pub provider: &'static str,
    /// `key` or `address`.
    pub kind: &'static str,
    /// Where it was found, in words for the user.
    pub source: String,
    /// The key or the address itself.
    pub value: String,
}

const GEMINI: &str = "gemini";
const ANTHROPIC: &str = "anthropic";
const OPENAI: &str = "openai-compatible";

/// The environment variables that hold an API key, with the service each belongs to. The first one that is set for a
/// service is the one offered: the later names are the older spellings of the same key.
const KEY_VARIABLES: &[(&str, &str)] = &[
    ("GEMINI_API_KEY", GEMINI),
    ("GOOGLE_API_KEY", GEMINI),
    ("GOOGLE_GENERATIVE_AI_API_KEY", GEMINI),
    ("ANTHROPIC_API_KEY", ANTHROPIC),
    ("OPENAI_API_KEY", OPENAI),
];

/// The environment variables that name the address of a local, OpenAI-compatible server.
const ADDRESS_VARIABLES: &[&str] = &["OPENAI_BASE_URL", "OPENAI_API_BASE", "OLLAMA_HOST"];

/// A setting is a key only when it looks like one: long enough to be a token, and on one line.
fn is_plausible_key(value: &str) -> bool {
    let value = value.trim();
    value.len() >= 16 && value.len() <= 512 && value.chars().all(|c| !c.is_whitespace())
}

fn is_plausible_address(value: &str) -> bool {
    let value = value.trim();
    (value.starts_with("http://") || value.starts_with("https://"))
        && value.len() <= 512
        && value.chars().all(|c| !c.is_whitespace())
}

/// The findings in the environment. `read` is the lookup, so the tests do not touch the real environment.
pub fn environment_findings(read: impl Fn(&str) -> Option<String>) -> Vec<SystemAiSetup> {
    let mut found: Vec<SystemAiSetup> = Vec::new();
    for (variable, provider) in KEY_VARIABLES {
        if found
            .iter()
            .any(|entry| entry.provider == *provider && entry.kind == "key")
        {
            continue;
        }
        if let Some(value) = read(variable).filter(|value| is_plausible_key(value)) {
            found.push(SystemAiSetup {
                provider,
                kind: "key",
                source: format!("the {variable} environment variable"),
                value: value.trim().to_string(),
            });
        }
    }
    for variable in ADDRESS_VARIABLES {
        if let Some(value) = read(variable) {
            // OLLAMA_HOST is often a bare host and port, which is an address once it has a scheme.
            let value = value.trim().to_string();
            let value = if value.starts_with("http") {
                value
            } else {
                format!("http://{value}")
            };
            if is_plausible_address(&value) {
                found.push(SystemAiSetup {
                    provider: OPENAI,
                    kind: "address",
                    source: format!("the {variable} environment variable"),
                    value,
                });
            }
        }
    }
    found
}

/// The configuration files of other tools that hold a key, below the user's home folder.
const CONFIG_FILES: &[&str] = &[".gemini/.env", ".config/io.datasette.llm/keys.json"];

/// The findings in one configuration file. `name` is the path below the home folder, which decides how it is read.
pub fn file_findings(name: &str, contents: &str) -> Vec<SystemAiSetup> {
    let source = format!("~/{name}");
    if name.ends_with(".json") {
        return json_key_findings(contents, &source);
    }
    dotenv_findings(contents, &source)
}

/// `KEY=value` lines, as the Gemini CLI keeps them. Quotes around a value and `export` in front of it are allowed.
fn dotenv_findings(contents: &str, source: &str) -> Vec<SystemAiSetup> {
    let mut lines: Vec<(String, String)> = Vec::new();
    for line in contents.lines() {
        let line = line.trim().strip_prefix("export ").unwrap_or(line.trim());
        if line.starts_with('#') {
            continue;
        }
        if let Some((name, value)) = line.split_once('=') {
            let value = value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
            lines.push((name.trim().to_string(), value));
        }
    }
    environment_findings(|wanted| {
        lines
            .iter()
            .find(|(name, _)| name == wanted)
            .map(|(_, value)| value.clone())
    })
    .into_iter()
    .map(|found| SystemAiSetup {
        source: format!(
            "{source} ({})",
            found
                .source
                .trim_start_matches("the ")
                .trim_end_matches(" environment variable")
        ),
        ..found
    })
    .collect()
}

/// A JSON object of keys by service name, as the `llm` command line tool keeps them.
fn json_key_findings(contents: &str, source: &str) -> Vec<SystemAiSetup> {
    let Ok(serde_json::Value::Object(fields)) = serde_json::from_str::<serde_json::Value>(contents)
    else {
        return Vec::new();
    };
    // The names these tools use for the services, by the app's own provider name.
    const NAMES: &[(&str, &str)] = &[
        ("gemini", GEMINI),
        ("google", GEMINI),
        ("claude", ANTHROPIC),
        ("anthropic", ANTHROPIC),
        ("openai", OPENAI),
    ];
    let mut found: Vec<SystemAiSetup> = Vec::new();
    for (name, provider) in NAMES {
        if found.iter().any(|entry| entry.provider == *provider) {
            continue;
        }
        let value = fields
            .get(*name)
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        if is_plausible_key(value) {
            found.push(SystemAiSetup {
                provider,
                kind: "key",
                source: format!("{source} ({name})"),
                value: value.trim().to_string(),
            });
        }
    }
    found
}

/// Everything found, with the findings of the environment first: a variable that is set now beats a file.
pub fn findings(
    home: Option<&Path>,
    read_file: impl Fn(&Path) -> Option<String>,
) -> Vec<SystemAiSetup> {
    let mut found = environment_findings(|name| std::env::var(name).ok());
    if let Some(home) = home {
        for name in CONFIG_FILES {
            let path: PathBuf = home.join(name);
            let Some(contents) = read_file(&path) else {
                continue;
            };
            for finding in file_findings(name, &contents) {
                let known = found
                    .iter()
                    .any(|entry| entry.provider == finding.provider && entry.kind == finding.kind);
                if !known {
                    found.push(finding);
                }
            }
        }
    }
    found
}

/// Reads a small text file, or nothing when it is missing, unreadable or too large to be such a setting.
pub fn read_small_file(path: &Path) -> Option<String> {
    const LIMIT: u64 = 64 * 1024;
    let size = std::fs::metadata(path).ok()?.len();
    if size > LIMIT {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |name| {
            pairs
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_string())
        }
    }

    #[test]
    fn a_key_in_the_environment_is_found_and_named() {
        let found = environment_findings(lookup(&[("GEMINI_API_KEY", "AIza-0123456789abcdef")]));

        assert_eq!(
            found,
            vec![SystemAiSetup {
                provider: GEMINI,
                kind: "key",
                source: "the GEMINI_API_KEY environment variable".into(),
                value: "AIza-0123456789abcdef".into(),
            }]
        );
    }

    #[test]
    fn one_key_per_service_is_offered_and_the_first_spelling_wins() {
        let found = environment_findings(lookup(&[
            ("GEMINI_API_KEY", "AIza-0123456789abcdef"),
            ("GOOGLE_API_KEY", "AIza-fedcba9876543210"),
        ]));

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].value, "AIza-0123456789abcdef");
    }

    #[test]
    fn a_value_that_cannot_be_a_key_is_left_alone() {
        for value in ["", "   ", "short", "a key with spaces in it"] {
            let read = |name: &str| (name == "ANTHROPIC_API_KEY").then(|| value.to_string());
            assert!(environment_findings(read).is_empty(), "{value:?}");
        }
        assert!(is_plausible_key("sk-ant-0123456789abcdef"));
    }

    #[test]
    fn a_local_address_is_found_and_gets_a_scheme_when_it_has_none() {
        let found = environment_findings(lookup(&[("OLLAMA_HOST", "192.168.1.50:11434")]));

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, "address");
        assert_eq!(found[0].value, "http://192.168.1.50:11434");
        assert_eq!(found[0].provider, OPENAI);
    }

    #[test]
    fn keys_in_a_dotenv_file_are_found_with_the_file_as_their_source() {
        let found = file_findings(
            ".gemini/.env",
            "# the key of the CLI\nexport GEMINI_API_KEY=\"AIza-0123456789abcdef\"\nOTHER=1\n",
        );

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].provider, GEMINI);
        assert_eq!(found[0].value, "AIza-0123456789abcdef");
        assert_eq!(found[0].source, "~/.gemini/.env (GEMINI_API_KEY)");
    }

    #[test]
    fn keys_in_a_json_file_are_found_by_the_name_the_other_tool_uses() {
        let found = file_findings(
            ".config/io.datasette.llm/keys.json",
            r#"{ "gemini": "AIza-0123456789abcdef", "claude": "sk-ant-0123456789abcdef", "openai": "no" }"#,
        );

        assert_eq!(
            found
                .iter()
                .map(|entry| (entry.provider, entry.source.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (GEMINI, "~/.config/io.datasette.llm/keys.json (gemini)"),
                (ANTHROPIC, "~/.config/io.datasette.llm/keys.json (claude)"),
            ]
        );
    }

    #[test]
    fn a_file_that_is_not_a_setting_file_reports_nothing() {
        assert!(file_findings(".config/io.datasette.llm/keys.json", "not json").is_empty());
        assert!(file_findings(".gemini/.env", "nothing to see").is_empty());
    }

    #[test]
    fn a_file_adds_only_a_service_the_environment_does_not_already_have() {
        let home = PathBuf::from("/home/alice");
        let found = findings(Some(&home), |path| {
            if path.ends_with(".config/io.datasette.llm/keys.json") {
                Some(r#"{ "claude": "sk-ant-0123456789abcdef" }"#.to_string())
            } else {
                None
            }
        });

        // The environment of the test run has no keys, so only the file's finding is here.
        assert_eq!(
            found
                .iter()
                .filter(|entry| entry.provider == ANTHROPIC)
                .count(),
            1
        );
    }

    #[test]
    fn a_missing_home_folder_is_no_failure() {
        assert!(
            findings(None, |_| None)
                .iter()
                .all(|entry| entry.kind == "key" || entry.kind == "address")
        );
    }
}
