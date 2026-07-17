use planscope_parser::{parse, Engine};

#[test]
fn parses_a_plan_for_each_supported_engine() {
    let pg = parse(
        Engine::Postgres,
        "Seq Scan on users  (cost=0.00..1.00 rows=1 width=4) (actual time=0.01..0.20 rows=1 loops=1)",
    )
    .expect("postgres plan should parse");
    assert_eq!(pg.node_type, "Seq Scan");

    let mysql = parse(
        Engine::MySql,
        r#"{"query_block":{"table":{"table_name":"users","access_type":"ALL","rows_examined_per_scan":1}}}"#,
    )
    .expect("mysql plan should parse");
    assert_eq!(mysql.relation.as_deref(), Some("users"));

    let sqlite = parse(Engine::Sqlite, "0|0|0|SCAN users").expect("sqlite plan should parse");
    assert_eq!(sqlite.node_type, "SCAN");
}

#[test]
fn self_time_subtracts_children_from_inclusive_total() {
    let plan = parse(
        Engine::Postgres,
        "\
Hash Join  (cost=1.11..2.22 rows=10 width=8) (actual time=0.50..10.00 rows=10 loops=1)
  ->  Seq Scan on a  (cost=0.00..1.00 rows=10 width=4) (actual time=0.01..4.00 rows=10 loops=1)
  ->  Seq Scan on b  (cost=0.00..1.00 rows=10 width=4) (actual time=0.01..3.00 rows=10 loops=1)
",
    )
    .unwrap();

    assert_eq!(plan.self_time_ms(), Some(3.0));
}
