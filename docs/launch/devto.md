# I built a query plan visualizer that looks at self-time

When a database query slows an application down, I usually start with
`EXPLAIN ANALYZE`. The answer is in that output, but it is mixed into costs,
row estimates, loop counts, indentation, and timing for every operation in the
plan. Under incident pressure, finding the one expensive node can take longer
than collecting the plan.

I built [Planflare](https://apps.charliekrug.com/planscope/) to shorten that
step. You paste PostgreSQL, MySQL, or SQLite EXPLAIN output into the browser and
get a collapsible cost tree. The node consuming the most runtime is marked in
red. If the planner expected 10 rows and processed 1,200, that mismatch is
marked beside the node in blue.

The source is on
[GitHub](https://github.com/ctkrug/planscope) under the MIT license.

## One model at the parser boundary

The three supported engines do not describe plans the same way. PostgreSQL's
text output uses indentation and arrow markers. PostgreSQL and MySQL also offer
JSON, but their keys and nesting differ. SQLite returns rows linked by numeric
id and parent columns.

I wrote an engine-specific parser for each format in Rust and normalize every
result into one `PlanNode` shape: node type, relation, estimated cost and rows,
actual time and rows, loops, and children. That keeps engine branches out of
the renderer. Once parsing finishes, the TypeScript UI only knows that it has a
tree.

Rust compiles to WebAssembly with `wasm-bindgen`. That choice lets the parser
run entirely in the browser. A plan can contain literal filter values, so
keeping it local is more than a deployment convenience. There is no API call
and no database credential to configure.

PostgreSQL text was the format that needed the most defensive work. The parser
tracks indentation with an explicit stack, skips detail lines such as filters
and buffers, and recognizes psql table framing. Property tests feed arbitrary
strings to every parser to catch panics. Deep MySQL and SQLite fixtures also
check that hostile nesting cannot overflow the process stack.

## Why total time points at the wrong node

The first hotspot implementation compared `actual_time_total_ms` across nodes.
That highlights the root almost every time because a parent's total includes
all of its children.

Planflare instead computes self-time:

```text
self time = node total time - sum(direct child total times)
```

The subtraction is clamped at zero for hand-edited or unusual plans where
child totals exceed the parent. The node with the largest remainder gets the
hotspot treatment. This is a small calculation, but it changes the result from
"the query was slow" to "this sequential scan consumed the time."

Row estimates provide the second signal. When estimated and actual rows differ
by more than 10 times in either direction, Planflare adds a mismatch badge.
That often explains why the planner selected the scan or join now burning the
runtime.

## What I would change next time

I would build the fixture corpus before the interface. Early parser examples
covered clean output from each engine, but copied terminal text includes table
borders, trailing row counts, malformed JSON, and partial plans. Adding those
cases earlier would have made the input boundary explicit from the start.

I would also separate structured PostgreSQL JSON support from text parsing in
the first milestone. JSON is the better interchange format when a user can
choose it, while text remains important because it is what people already have
in logs and incident notes.

Planflare is live at
[apps.charliekrug.com/planscope](https://apps.charliekrug.com/planscope/).
I would be interested to hear which plan fields you reach for after finding the
slow node, especially for MySQL and SQLite.
