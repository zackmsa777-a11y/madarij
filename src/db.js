import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { defaults } from "./config.js";

export function openStore(file, initial = defaults()) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY, rev INTEGER, body TEXT);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, uid TEXT, path TEXT, channel TEXT, at INTEGER, hash TEXT, counted INTEGER);
    CREATE INDEX IF NOT EXISTS event_window ON events(uid,path,at);
    CREATE TABLE IF NOT EXISTS members(uid TEXT PRIMARY KEY, name TEXT, roles TEXT);
    CREATE TABLE IF NOT EXISTS progress(uid TEXT, path TEXT, count INTEGER DEFAULT 0, last INTEGER DEFAULT 0, unlocked INTEGER DEFAULT 0, PRIMARY KEY(uid,path));
    CREATE TABLE IF NOT EXISTS grants(uid TEXT,path TEXT,role TEXT,at INTEGER, PRIMARY KEY(uid,path,role));
    CREATE TABLE IF NOT EXISTS approvals(uid TEXT,path TEXT,role TEXT, PRIMARY KEY(uid,path,role));
    CREATE TABLE IF NOT EXISTS deferred(uid TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS flags(id INTEGER PRIMARY KEY,uid TEXT,path TEXT,reason TEXT,evidence TEXT,status TEXT,actor TEXT,at INTEGER);
    CREATE UNIQUE INDEX IF NOT EXISTS open_flag ON flags(uid,path) WHERE status IN ('open','hold');
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER,actor TEXT,kind TEXT,detail TEXT);`);
  db.prepare("INSERT OR IGNORE INTO settings VALUES(1,1,?)").run(
    JSON.stringify(initial),
  );
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function tx(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return {
    db,
    one,
    all,
    run,
    tx,
    settings() {
      const s = one("SELECT * FROM settings");
      return { rev: s.rev, config: JSON.parse(s.body) };
    },
    audit(actor, kind, detail) {
      run(
        "INSERT INTO audit(at,actor,kind,detail) VALUES(?,?,?,?)",
        Date.now(),
        actor,
        kind,
        JSON.stringify(detail),
      );
    },
  };
}
