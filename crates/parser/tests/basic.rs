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

#[test]
fn postgres_json_matches_the_equivalent_text_plan() {
    let text = parse(
        Engine::Postgres,
        "\
Hash Join  (cost=1.00..10.00 rows=10 width=8) (actual time=0.50..9.00 rows=8 loops=1)
  ->  Seq Scan on users  (cost=0.00..4.00 rows=2 width=4) (actual time=0.10..7.00 rows=200 loops=1)",
    )
    .unwrap();
    let json = parse(
        Engine::Postgres,
        r#"[{"Plan":{"Node Type":"Hash Join","Startup Cost":1.00,"Total Cost":10.00,"Plan Rows":10,"Actual Startup Time":0.50,"Actual Total Time":9.00,"Actual Rows":8,"Actual Loops":1,"Plans":[{"Node Type":"Seq Scan","Relation Name":"users","Startup Cost":0.00,"Total Cost":4.00,"Plan Rows":2,"Actual Startup Time":0.10,"Actual Total Time":7.00,"Actual Rows":200,"Actual Loops":1}]}}]"#,
    )
    .unwrap();

    assert_eq!(json, text);
}
