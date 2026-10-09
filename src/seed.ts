import type { DatabaseSync } from "node:sqlite";

export function seed(db: DatabaseSync) {
  const rows: [string, unknown[][]][] = [
    ["brands", [["brd_sp", "Marca SP", "America/Sao_Paulo"], ["brd_manaus", "Marca Manaus", "America/Manaus"]]],
    ["creators", [["crt_ana", "Ana"], ["crt_bruno", "Bruno"]]],
    ["campaigns", [["cmp_verao", "brd_sp", "Verão"], ["cmp_norte", "brd_manaus", "Norte"]]],
  ];
  for (const [table, values] of rows) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO ${table} VALUES (${values[0]!.map(() => "?").join(", ")})`);
    for (const v of values) stmt.run(...(v as string[]));
  }
}
