//! Parses Postgres `EXPLAIN` / `EXPLAIN ANALYZE` text-format output.
//!
//! Postgres indents child nodes under a `->` marker, with the indentation
//! column increasing (but not by a fixed amount) with depth. Rather than
//! regex-matching whole lines, this walks the text as an indentation-based
//! tree: an explicit stack tracks which node is the current parent at each
//! indent level, closing nodes out as shallower lines arrive.

use crate::model::{ParseError, PlanNode};
use serde_json::Value;

pub fn parse(text: &str) -> Result<PlanNode, ParseError> {
    if matches!(text.trim_start().as_bytes().first(), Some(b'[' | b'{')) {
        return parse_json(text);
    }

    parse_text(text)
}

fn parse_text(text: &str) -> Result<PlanNode, ParseError> {
    let mut stack: Vec<(usize, PlanNode)> = Vec::new();

    for raw_line in text.lines() {
        let line = raw_line.trim_end();
        let trimmed = line.trim_start();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("Planning Time:")
            || trimmed.starts_with("Execution Time:")
            || trimmed.starts_with("Planning time:")
            || trimmed.starts_with("Execution time:")
            || trimmed == "QUERY PLAN"
        {
            continue;
        }

        let (indent, body) = if let Some(pos) = line.find("->") {
            (pos, line[pos + 2..].trim_start())
        } else if stack.is_empty() {
            (0, trimmed)
        } else {
            // A detail line (Filter:, Index Cond:, Buffers:, ...) belonging
            // to the current node. Not modeled on the tree in v1.
            continue;
        };

        let node = parse_node_line(body);

        while stack.len() > 1 && stack.last().unwrap().0 >= indent {
            let (_, finished) = stack.pop().unwrap();
            stack.last_mut().unwrap().1.children.push(finished);
        }
        stack.push((indent, node));
    }

    if stack.is_empty() {
        return Err(ParseError::new("no plan lines found"));
    }
    while stack.len() > 1 {
        let (_, finished) = stack.pop().unwrap();
        stack.last_mut().unwrap().1.children.push(finished);
    }
    Ok(stack.pop().unwrap().1)
}

/// Parses PostgreSQL's `EXPLAIN (FORMAT JSON)` envelope. PostgreSQL emits an
/// array with one object containing `Plan`; accepting the inner object too is
/// useful for copied plan fragments and keeps auto-detection format-agnostic.
fn parse_json(text: &str) -> Result<PlanNode, ParseError> {
    let value: Value = serde_json::from_str(text)
        .map_err(|error| ParseError::new(format!("invalid Postgres EXPLAIN JSON: {error}")))?;

    let plan = match &value {
        Value::Array(items) => items
            .first()
            .and_then(|item| item.get("Plan"))
            .ok_or_else(|| ParseError::new("missing \"Plan\" in Postgres EXPLAIN JSON"))?,
        Value::Object(_) => value.get("Plan").unwrap_or(&value),
        _ => {
            return Err(ParseError::new(
                "Postgres EXPLAIN JSON must be an object or array",
            ))
        }
    };

    node_from_json(plan)
}

fn node_from_json(value: &Value) -> Result<PlanNode, ParseError> {
    let node_type = value
        .get("Node Type")
        .and_then(Value::as_str)
        .ok_or_else(|| ParseError::new("missing \"Node Type\" in Postgres EXPLAIN JSON node"))?;
    let mut node = PlanNode::new(node_type);
    node.relation = value
        .get("Relation Name")
        .and_then(Value::as_str)
        .map(String::from);
    node.estimated_cost_start = json_number(value, "Startup Cost");
    node.estimated_cost_total = json_number(value, "Total Cost");
    node.estimated_rows = json_u64(value, "Plan Rows");
    node.actual_time_start_ms = json_number(value, "Actual Startup Time");
    node.actual_time_total_ms = json_number(value, "Actual Total Time");
    node.actual_rows = json_u64(value, "Actual Rows");
    node.actual_loops = json_u64(value, "Actual Loops");

    if let Some(children) = value.get("Plans") {
        let children = children.as_array().ok_or_else(|| {
            ParseError::new("\"Plans\" must be an array in Postgres EXPLAIN JSON")
        })?;
        node.children = children
            .iter()
            .map(node_from_json)
            .collect::<Result<Vec<_>, _>>()?;
    }
    Ok(node)
}

fn json_number(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn json_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

fn parse_node_line(body: &str) -> PlanNode {
    let head_end = body.find('(').unwrap_or(body.len());
    let head = body[..head_end].trim();

    let (node_type, relation) = match head.find(" on ") {
        Some(pos) => (
            head[..pos].trim().to_string(),
            Some(head[pos + 4..].trim().to_string()),
        ),
        None => (head.to_string(), None),
    };

    let mut node = PlanNode::new(node_type);
    node.relation = relation;

    if let Some(cost_group) = paren_group(body, "(cost=") {
        if let Some((start, total)) = extract_field(cost_group, "cost=").and_then(split_range) {
            node.estimated_cost_start = start.parse().ok();
            node.estimated_cost_total = total.parse().ok();
        }
        node.estimated_rows = extract_field(cost_group, "rows=").and_then(|s| s.parse().ok());
    }

    if let Some(actual_group) = paren_group(body, "(actual") {
        if let Some((start, total)) = extract_field(actual_group, "time=").and_then(split_range) {
            node.actual_time_start_ms = start.parse().ok();
            node.actual_time_total_ms = total.parse().ok();
        }
        node.actual_rows = extract_field(actual_group, "rows=").and_then(|s| s.parse().ok());
        node.actual_loops = extract_field(actual_group, "loops=").and_then(|s| s.parse().ok());
    }

    node
}

/// Returns the contents between `(` and the next `)`, starting at `open_marker`.
fn paren_group<'a>(body: &'a str, open_marker: &str) -> Option<&'a str> {
    let start = body.find(open_marker)?;
    let inner_start = start + 1;
    let end = body[inner_start..].find(')')? + inner_start;
    Some(&body[inner_start..end])
}

fn extract_field<'a>(s: &'a str, key: &str) -> Option<&'a str> {
    let start = s.find(key)? + key.len();
    let rest = &s[start..];
    let end = rest.find(' ').unwrap_or(rest.len());
    Some(&rest[..end])
}

fn split_range(s: &str) -> Option<(&str, &str)> {
    let mut parts = s.split("..");
    let start = parts.next()?;
    let end = parts.next()?;
    Some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_seq_scan() {
        let plan = parse(
            "Seq Scan on users  (cost=0.00..35.50 rows=2550 width=4) (actual time=0.010..0.410 rows=2550 loops=1)",
        )
        .unwrap();
        assert_eq!(plan.node_type, "Seq Scan");
        assert_eq!(plan.relation.as_deref(), Some("users"));
        assert_eq!(plan.estimated_cost_start, Some(0.00));
        assert_eq!(plan.estimated_cost_total, Some(35.50));
        assert_eq!(plan.estimated_rows, Some(2550));
        assert_eq!(plan.actual_time_total_ms, Some(0.410));
        assert_eq!(plan.actual_rows, Some(2550));
        assert_eq!(plan.actual_loops, Some(1));
        assert!(plan.children.is_empty());
    }

    #[test]
    fn parses_nested_hash_join() {
        let text = "\
Hash Join  (cost=1.11..2.22 rows=10 width=8) (actual time=0.50..1.20 rows=10 loops=1)
  ->  Seq Scan on a  (cost=0.00..1.00 rows=10 width=4) (actual time=0.01..0.10 rows=10 loops=1)
  ->  Hash  (cost=1.00..1.00 rows=10 width=4) (actual time=0.20..0.20 rows=10 loops=1)
        ->  Seq Scan on b  (cost=0.00..1.00 rows=10 width=4) (actual time=0.01..0.05 rows=10 loops=1)
";
        let plan = parse(text).unwrap();
        assert_eq!(plan.node_type, "Hash Join");
        assert_eq!(plan.children.len(), 2);
        assert_eq!(plan.children[0].node_type, "Seq Scan");
        assert_eq!(plan.children[0].relation.as_deref(), Some("a"));
        assert_eq!(plan.children[1].node_type, "Hash");
        assert_eq!(plan.children[1].children.len(), 1);
        assert_eq!(plan.children[1].children[0].relation.as_deref(), Some("b"));
    }

    #[test]
    fn rejects_empty_and_whitespace_only_input() {
        assert!(parse("").is_err());
        assert!(parse("   \n\t  \n   ").is_err());
    }

    #[test]
    fn handles_a_unicode_relation_name_without_panicking() {
        let plan = parse(
            "Seq Scan on \u{8868}\u{30C6}\u{30FC}\u{30D6}\u{30EB}\u{1F600}  (cost=0.00..1.00 rows=1 width=4)",
        )
        .unwrap();
        assert_eq!(plan.node_type, "Seq Scan");
        assert_eq!(
            plan.relation.as_deref(),
            Some("\u{8868}\u{30C6}\u{30FC}\u{30D6}\u{30EB}\u{1F600}")
        );
    }

    #[test]
    fn drops_unparseable_numeric_fields_instead_of_erroring() {
        // A rows value that doesn't fit its target type (negative - Postgres
        // itself never emits this, but nothing stops a hand-edited paste)
        // shouldn't fail the whole parse - the field is simply absent, same
        // as a plan without ANALYZE data.
        let plan = parse("Seq Scan on t  (cost=0.00..1.00 rows=-5 width=4)").unwrap();
        assert_eq!(plan.estimated_cost_start, Some(0.0));
        assert_eq!(plan.estimated_cost_total, Some(1.0));
        assert_eq!(plan.estimated_rows, None);
    }

    #[test]
    fn parses_json_format_output_into_the_normalized_tree() {
        let plan = parse(
            r#"[
              {
                "Plan": {
                  "Node Type": "Hash Join",
                  "Startup Cost": 20.0,
                  "Total Cost": 60.0,
                  "Plan Rows": 12,
                  "Actual Startup Time": 0.5,
                  "Actual Total Time": 9.5,
                  "Actual Rows": 10,
                  "Actual Loops": 1,
                  "Plans": [
                    {
                      "Node Type": "Seq Scan",
                      "Relation Name": "users",
                      "Startup Cost": 0.0,
                      "Total Cost": 30.0,
                      "Plan Rows": 2,
                      "Actual Startup Time": 0.1,
                      "Actual Total Time": 8.0,
                      "Actual Rows": 200,
                      "Actual Loops": 1
                    }
                  ]
                }
              }
            ]"#,
        )
        .unwrap();

        assert_eq!(plan.node_type, "Hash Join");
        assert_eq!(plan.estimated_cost_start, Some(20.0));
        assert_eq!(plan.estimated_cost_total, Some(60.0));
        assert_eq!(plan.estimated_rows, Some(12));
        assert_eq!(plan.actual_time_total_ms, Some(9.5));
        assert_eq!(plan.actual_rows, Some(10));
        assert_eq!(plan.actual_loops, Some(1));
        assert_eq!(plan.children.len(), 1);
        assert_eq!(plan.children[0].node_type, "Seq Scan");
        assert_eq!(plan.children[0].relation.as_deref(), Some("users"));
    }

    #[test]
    fn rejects_malformed_json_when_the_input_starts_like_json() {
        let error = parse("[not valid JSON").unwrap_err();
        assert!(error.message.contains("invalid Postgres EXPLAIN JSON"));
    }

    proptest::proptest! {
        // No arbitrary string - however garbled - should ever panic the
        // parser; it must always resolve to Ok or a ParseError.
        #[test]
        fn never_panics_on_arbitrary_input(text in ".{0,500}") {
            let _ = parse(&text);
        }
    }
}
