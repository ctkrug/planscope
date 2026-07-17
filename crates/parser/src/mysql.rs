//! Parses MySQL `EXPLAIN FORMAT=JSON` output.
//!
//! MySQL's plan is already structured (unlike Postgres/SQLite text output),
//! but its shape varies by query: a lone `table`, a `nested_loop` array of
//! tables, or an operation wrapper (`grouping_operation`, `ordering_operation`,
//! ...) around an inner block. This walks that JSON recursively rather than
//! assuming one fixed schema.

use crate::model::{ParseError, PlanNode};
use serde_json::Value;

pub fn parse(text: &str) -> Result<PlanNode, ParseError> {
    let root: Value = serde_json::from_str(text)
        .map_err(|e| ParseError::new(format!("invalid MySQL EXPLAIN JSON: {e}")))?;

    let query_block = root
        .get("query_block")
        .ok_or_else(|| ParseError::new("missing \"query_block\" key"))?;

    Ok(node_from_block(query_block))
}

fn node_from_block(block: &Value) -> PlanNode {
    if let Some(table) = block.get("table") {
        return node_from_table(table);
    }
    if let Some(nested) = block.get("nested_loop").and_then(Value::as_array) {
        let mut node = PlanNode::new("Nested Loop");
        node.children = nested.iter().map(node_from_block).collect();
        return node;
    }
    for (key, label) in [
        ("grouping_operation", "Group"),
        ("ordering_operation", "Sort"),
        ("duplicates_removal", "Deduplicate"),
    ] {
        if let Some(inner) = block.get(key) {
            let mut node = PlanNode::new(label);
            node.children.push(node_from_block(inner));
            return node;
        }
    }
    PlanNode::new("Unknown")
}

fn node_from_table(table: &Value) -> PlanNode {
    let mut node = PlanNode::new(
        table
            .get("access_type")
            .and_then(Value::as_str)
            .unwrap_or("table"),
    );
    node.relation = table
        .get("table_name")
        .and_then(Value::as_str)
        .map(String::from);
    node.estimated_rows = table.get("rows_examined_per_scan").and_then(Value::as_u64);

    if let Some(cost_info) = table.get("cost_info") {
        node.estimated_cost_total = cost_info
            .get("prefix_cost")
            .or_else(|| cost_info.get("read_cost"))
            .and_then(Value::as_str)
            .and_then(|s| s.parse().ok());
    }

    node
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_table_scan() {
        let json = r#"{
            "query_block": {
                "select_id": 1,
                "cost_info": { "query_cost": "12.50" },
                "table": {
                    "table_name": "users",
                    "access_type": "ALL",
                    "rows_examined_per_scan": 100,
                    "cost_info": { "read_cost": "1.25", "eval_cost": "10.00", "prefix_cost": "11.25" }
                }
            }
        }"#;
        let plan = parse(json).unwrap();
        assert_eq!(plan.node_type, "ALL");
        assert_eq!(plan.relation.as_deref(), Some("users"));
        assert_eq!(plan.estimated_rows, Some(100));
        assert_eq!(plan.estimated_cost_total, Some(11.25));
    }

    #[test]
    fn parses_nested_loop_join() {
        let json = r#"{
            "query_block": {
                "select_id": 1,
                "nested_loop": [
                    { "table": { "table_name": "a", "access_type": "ALL", "rows_examined_per_scan": 5 } },
                    { "table": { "table_name": "b", "access_type": "ref", "rows_examined_per_scan": 1 } }
                ]
            }
        }"#;
        let plan = parse(json).unwrap();
        assert_eq!(plan.node_type, "Nested Loop");
        assert_eq!(plan.children.len(), 2);
        assert_eq!(plan.children[0].relation.as_deref(), Some("a"));
        assert_eq!(plan.children[1].relation.as_deref(), Some("b"));
    }

    #[test]
    fn rejects_invalid_json() {
        assert!(parse("not json").is_err());
    }
}
