# Planscope — vision

## The problem

`EXPLAIN` output is the ground truth for "why is this query slow," but reading it is a skill
most people relearn under pressure, at 2am, during an incident. The text is dense and
indentation-sensitive; the field that actually matters (the node burning 90% of the runtime) is
visually indistinguishable from the fields that don't. Every engine formats it differently, so
the skill doesn't transfer: Postgres people are lost in a MySQL `EXPLAIN FORMAT=JSON` dump, and
vice versa. Existing visualizers mostly solve this for one engine, or worse, regex-split the text
and silently mis-parse anything that deviates from the happy path (CTEs, subplans, parallel
workers, `Buffers:` lines interleaved with node lines).

## Who it's for

Backend engineers and DBAs who already know what an EXPLAIN plan *is* but don't want to
eyeball-parse 40 lines of nested cost annotations to find the one seq-scan that's killing them.
Not a beginner-education tool - a faster path to the same conclusion an expert would eventually
reach by hand.

## The core idea

Parse, don't pattern-match. A real parser for each engine's plan format normalizes into one
shared tree model (`PlanNode`: type, relation, estimated cost/rows, actual time/rows/loops,
children). Because the tree is uniform, the UI's job becomes simple and engine-agnostic: render a
tree, compute self-time (a node's total time minus its children's, since inclusive time always
overstates a parent), and highlight whichever node's self-time dominates. Everything runs
client-side - the parser compiles to WebAssembly - so no query plan text, which can contain
literal filter values and therefore sensitive data, ever leaves the browser.

## Key design decisions

- **Rust parser compiled to WASM, not a JS/regex parser.** EXPLAIN output has real (if informal)
  grammar: Postgres nests via variable-width indentation, MySQL nests via arbitrarily-shaped
  JSON, SQLite links nodes by numeric parent id. A parser that models these structurally survives
  format variation; regex breaks the moment a plan looks slightly different than the sample it
  was written against.
- **One normalized tree model across all three engines.** The UI never branches on "which
  database is this." Engine-specific quirks are absorbed at the parser boundary
  (`crates/parser/src/{postgres,mysql,sqlite}.rs`), not leaked into rendering.
- **Self-time, not total-time, drives the hotspot highlight.** A node's `actual_time_total_ms` is
  inclusive of every child's time. Highlighting by total time just highlights the root of every
  plan. `PlanNode::self_time_ms()` subtracts children's total from the node's own - that's the
  number that identifies the actual expensive step.
- **No server.** Static site, WASM parser, runs entirely in the browser. This is also why plan
  text is safe to paste - it's processing, not upload.
- **Multi-engine from day one**, not "Postgres now, others later." The three parser modules ship
  together in the scaffold so the shared model has to hold up across all three from the start,
  rather than being retrofitted around Postgres-only assumptions.

## What "v1 done" looks like

- Paste a real Postgres `EXPLAIN ANALYZE` text dump, a MySQL `EXPLAIN FORMAT=JSON` dump, or a
  SQLite `EXPLAIN QUERY PLAN` result, and get an interactive, collapsible tree in under a second.
- The node responsible for the largest share of self-time is visually highlighted without the
  user having to look for it.
- Rows where the planner's estimate and the actual row count diverge significantly are called out
  inline (this is usually the root cause of a bad plan, not just a symptom).
- Malformed or unrecognized input produces a clear inline error, never a silent wrong tree or a
  crash.
- The whole thing is a static site, deployable to `apps.charliekrug.com/planscope` with no
  backend, and works from a phone as well as a desktop monitor.
