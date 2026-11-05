import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../src/db.js";
import { demoAdapter } from "../src/demo.js";
import { validate, ladder } from "../src/config.js";
import {
  progress,
  pending,
  record,
  decideFlag,
  commitGrant,
  activePath,
} from "../src/engine.js";
import { service } from "../src/service.js";
import { card } from "../src/cards.js";

test("existing Discord ranks are recognized without sending lower-rank promotions", () => {
  const { store, path, event, config } = setup();
  record(store, event(1, { roles: ["member", "gold"] }), config);
  const state = progress(store, "u", path);
  assert.equal(state.current.role, "gold");
  assert.equal(state.next.role, "diamond");
  assert.equal(state.count, 1);
});

test("a daily cap delays the next award even when enough messages were already earned", () => {
  const { store, path, event, config } = setup();
  path.step = 1;
  path.dailyMax = 1;
  for (const n of [1, 2]) record(store, event(n), config);
  const first = pending(store, config, "u", ["member"]);
  commitGrant(store, "u", path, first.state);
  assert.equal(pending(store, config, "u", ["member"]), undefined);
  store.run("UPDATE grants SET at=? WHERE uid=?", Date.now() - 86400001, "u");
  assert.equal(pending(store, config, "u", ["member"]).state.next.role, "gold");
});

function setup(file = ":memory:") {
  const adapter = demoAdapter(),
    config = adapter.initial;
  const path = config.paths.find((p) => p.id === "members");
  path.step = 2;
  config.spam.enabled = false;
  const store = openStore(file, config);
  const event = (id, extra = {}) => ({
    uid: "u",
    id: String(id),
    at: 100000 + Number(id) * 1000,
    roles: ["member"],
    channel: "general",
    name: "عضو",
    content: "مرحبا بك",
    ...extra,
  });
  return { store, path, adapter, config, event };
}
test("class defaults change inherited steps only; preview and engine agree", () => {
  const { path } = setup();
  path.stages[1].cost = 7;
  assert.deepEqual(
    ladder(path).map((s) => s.total),
    [2, 9, 11],
  );
  path.step = 5;
  assert.deepEqual(
    ladder(path).map((s) => s.total),
    [5, 12, 17],
  );
});
test("one qualifying message is counted once across retries and restart", () => {
  const file = join(mkdtempSync(join(tmpdir(), "madarij-")), "test.db");
  const { store, config, path, event } = setup(file);
  path.channels = ["general"];
  path.cooldown = 3;
  path.minWords = 2;
  for (const e of [
    event(1),
    event(1),
    event(2),
    event(4, { content: "كلمة" }),
    event(5, { channel: "review" }),
    event(6),
  ])
    record(store, e, config);
  store.db.close();
  const reloaded = openStore(file);
  assert.equal(progress(reloaded, "u", path).count, 2);
  reloaded.db.close();
});
test("suspicious bursts merge; deduction is selective, atomic and cannot be repeated", () => {
  const { store, config, path, event } = setup();
  Object.assign(config.spam, {
    enabled: true,
    burst: 2,
    repeats: 0,
    hold: true,
  });
  for (const n of [1, 2, 3]) record(store, event(n), config);
  assert.equal(store.one("SELECT count(*) n FROM flags").n, 1);
  assert.equal(pending(store, config, "u", ["member"]), undefined);
  assert.throws(() => decideFlag(store, 1, "exclude", "mod", ["unknown"]));
  assert.equal(decideFlag(store, 1, "exclude", "mod", ["3"]).removed, 1);
  assert.equal(progress(store, "u", path).count, 2);
  assert.throws(() => decideFlag(store, 1, "exclude", "mod"));
  assert.equal(
    pending(store, config, "u", ["member"]).state.next.role,
    "silver",
  );
});
test("transition gives one-time credit and keeps original path history; manual target awaits approval", () => {
  const { store, config, path, event } = setup();
  path.stages = path.stages.slice(0, 1);
  path.next = "staff-track";
  path.carry = true;
  const dest = config.paths[0];
  dest.step = 2;
  for (const n of [1, 2]) record(store, event(n), config);
  const first = pending(store, config, "u", ["member"]);
  commitGrant(store, "u", first.path, first.state);
  assert.equal(activePath(store, config, "u", ["member"]).id, dest.id);
  assert.equal(progress(store, "u", dest).count, 2);
  assert.equal(progress(store, "u", path).count, 2);
  assert.equal(pending(store, config, "u", ["member"]).needsApproval, true);
  store.run("INSERT INTO approvals VALUES(?,?,?)", "u", dest.id, "lead");
  assert.equal(pending(store, config, "u", ["member"]).needsApproval, false);
});
test("disabled, deleted or privileged roles and cyclic chains are rejected during validation", async () => {
  const { adapter, config, path } = setup(),
    catalog = await adapter.catalog();
  assert.doesNotThrow(() => validate(config, catalog, true));
  path.next = path.id;
  assert.throws(() => validate(config, catalog, true));
  path.next = "";
  catalog.roles.find((r) => r.id === "silver").sensitive = true;
  assert.throws(() => validate(config, catalog, true));
  path.stages[0].manual = true;
  assert.doesNotThrow(() => validate(config, catalog, true));
  catalog.roles.find((r) => r.id === "silver").editable = false;
  assert.throws(() => validate(config, catalog, true));
});
test("duplicate concurrent deliveries and temporary Discord failure recover without a second grant or card", async () => {
  const { store, adapter, event } = setup();
  let fail = true,
    grants = 0,
    announcements = 0;
  adapter.grant = async () => {
    if (fail) throw Error("temporary");
    grants++;
  };
  adapter.notify = async (ch, data) => {
    if (ch === "promotions") {
      announcements++;
      assert.ok(data.files[0].attachment.length);
    }
  };
  const svc = service(store, () => adapter);
  await Promise.all([
    svc.message(event(1)),
    svc.message(event(2)),
    svc.message(event(2)),
  ]);
  assert.equal(grants, 0);
  fail = false;
  await svc.serialize(() => svc.evaluate("u"));
  await svc.serialize(() => svc.evaluate("u"));
  assert.equal(grants, 1);
  assert.equal(announcements, 1);
  assert.equal(store.one("SELECT count(*) n FROM grants").n, 1);
});
test("PNG renders with the authored Arabic font and custom colors", async () => {
  const { config } = setup();
  const png = await card({
    brand: config.brand,
    name: "مدارج",
    path: "الأعضاء",
    count: 2,
    target: 5,
    next: "Gold",
  });
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1000);
});
