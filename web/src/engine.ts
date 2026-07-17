export type Engine = "postgres" | "mysql" | "sqlite";

const ENGINES: readonly Engine[] = ["postgres", "mysql", "sqlite"];

export function isEngine(value: string): value is Engine {
  return (ENGINES as readonly string[]).includes(value);
}

export function engineLabel(engine: Engine): string {
  switch (engine) {
    case "postgres":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "sqlite":
      return "SQLite";
  }
}
