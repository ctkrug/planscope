mod model;
mod mysql;
mod postgres;
mod sqlite;

pub use model::{Engine, ParseError, PlanNode};

/// Parses `text` as an EXPLAIN plan produced by `engine`, returning the
/// normalized [`PlanNode`] tree.
pub fn parse(engine: Engine, text: &str) -> Result<PlanNode, ParseError> {
    match engine {
        Engine::Postgres => postgres::parse(text),
        Engine::MySql => mysql::parse(text),
        Engine::Sqlite => sqlite::parse(text),
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use wasm_bindgen::prelude::*;

    /// JS entrypoint: parses `text` for `engine` ("postgres" | "mysql" | "sqlite")
    /// and returns the normalized plan tree, or throws with a message on failure.
    #[wasm_bindgen]
    pub fn parse_plan(engine: &str, text: &str) -> Result<JsValue, JsValue> {
        let engine = match engine {
            "postgres" => Engine::Postgres,
            "mysql" => Engine::MySql,
            "sqlite" => Engine::Sqlite,
            other => return Err(JsValue::from_str(&format!("unknown engine \"{other}\""))),
        };
        let plan = parse(engine, text).map_err(|e| JsValue::from_str(&e.message))?;
        serde_wasm_bindgen::to_value(&plan).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}
