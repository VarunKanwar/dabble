import assert from "node:assert/strict";
import test from "node:test";
import { enforceReadonlySql } from "../extension/readonlySql";

test("enforceReadonlySql allows readonly statements", () => {
  assert.equal(enforceReadonlySql("SELECT * FROM table_name;"), "SELECT * FROM table_name");
  assert.equal(enforceReadonlySql("-- comment\nWITH x AS (SELECT 1) SELECT * FROM x;"), "-- comment\nWITH x AS (SELECT 1) SELECT * FROM x");
  assert.equal(enforceReadonlySql("VALUES (1), (2);"), "VALUES (1), (2)");
});

test("enforceReadonlySql rejects empty input and writes", () => {
  assert.throws(() => enforceReadonlySql("   "), /Enter a SQL query/);
  assert.throws(() => enforceReadonlySql("INSERT INTO t VALUES (1)"), /only allows readonly queries/);
  assert.throws(() => enforceReadonlySql("CREATE TABLE t AS SELECT 1"), /only allows readonly queries/);
});
