import express from "express";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { openStore } from "./src/db.js";
import { defaults, newPath, validate, ladder } from "./src/config.js";
import { discordAdapter } from "./src/discord.js";
import { demoAdapter } from "./src/demo.js";
import { setupAuth } from "./src/auth.js";
import { record, pending, decideFlag } from "./src/engine.js";
import { service } from "./src/service.js";
import { card } from "./src/cards.js";

const demo = process.argv.includes("--demo"),
  env = process.env;
const host = demo ? "127.0.0.1" : env.HOST || "127.0.0.1",
  port = Number(env.PORT || 4173);
const origin = new URL(
  demo
    ? "http://127.0.0.1:" + port
    : env.PUBLIC_ORIGIN || "http://127.0.0.1:" + port,
).origin;
if (
  !demo &&
  !origin.startsWith("https://") &&
  !["127.0.0.1", "localhost"].includes(new URL(origin).hostname)
)
  throw Error("Use HTTPS for a public dashboard");
let adapter = demo
  ? demoAdapter((uid) => {
      const member = store.one("SELECT roles FROM members WHERE uid=?", uid);
      return member ? JSON.parse(member.roles) : undefined;
    })
  : null;
const store = openStore(
  demo ? "data/demo.sqlite" : env.DATABASE_PATH || "data/madarij.sqlite",
  adapter?.initial ?? defaults(),
);
store.db.exec(
  "CREATE TABLE IF NOT EXISTS installation(guild TEXT PRIMARY KEY);",
);
const guildKey = demo ? "demo" : env.GUILD_ID;
if (
  !guildKey ||
  store.one("SELECT guild FROM installation WHERE guild<>?", guildKey)
)
  throw Error("Use a separate database for each guild");
store.run("INSERT OR IGNORE INTO installation VALUES(?)", guildKey);
const svc = service(store, () => adapter);
if (!demo) adapter = await discordAdapter(env, store, svc);
if (demo && !store.one("SELECT 1 FROM members LIMIT 1")) {
  const { config } = store.settings();
  for (let i = 0; i < 17; i++)
    record(
      store,
      {
        id: "sample-" + i,
        uid: "member-demo",
        name: "عضو التجربة",
        roles: ["member"],
        at: Date.now() - (17 - i) * 90000,
        channel: "general",
        content: "تجربة " + i,
      },
      config,
    );
}

const app = express();
if (demo)
  app.use((req, res, next) =>
    ["127.0.0.1", "localhost"].includes(req.hostname)
      ? next()
      : res.sendStatus(403),
  );
setupAuth(app, { origin, demo, adapter, env });
app.use(express.json({ limit: "512kb" }));
const root = fileURLToPath(new URL(".", import.meta.url));
app.use("/assets", express.static(resolve(root, "assets")));
app.use(express.static(resolve(root, "public")));
function rights(user, config) {
  const out = {};
  for (const k of Object.keys(config.access))
    out[k] = user.owner || config.access[k].some((r) => user.roles.includes(r));
  return out;
}
function ensure(value, msg, code = 403) {
  if (!value) throw Object.assign(Error(msg), { status: code });
}
const assigned = (user, path) =>
  !path.managerRoles.length ||
  path.managerRoles.some((r) => user.roles.includes(r));
function approvals(user, config, auth) {
  if (!auth.admin && !auth.operator) return [];
  return store.all("SELECT * FROM members").flatMap((m) => {
    const job = pending(store, config, m.uid, JSON.parse(m.roles));
    if (!job?.needsApproval || (!auth.admin && !assigned(user, job.path)))
      return [];
    return [
      {
        uid: m.uid,
        name: m.name,
        path: job.path.id,
        role: job.state.next.role,
        count: job.state.count,
      },
    ];
  });
}
app.get("/api/state", async (req, res) => {
  const { config, rev } = store.settings(),
    access = rights(req.user, config);
  ensure(Object.values(access).some(Boolean), "حسابك لا يملك رتبة دخول للوحة");
  const catalog = await adapter.catalog();
  const flags =
    access.admin || access.reviewer
      ? store
          .all("SELECT * FROM flags ORDER BY id DESC LIMIT 200")
          .map((f) => ({ ...f, evidence: JSON.parse(f.evidence) }))
      : [];
  const audit = store
    .all("SELECT * FROM audit ORDER BY id DESC LIMIT 200")
    .filter(
      (row) =>
        (access.admin || access.reviewer || !row.kind.includes("فلاق")) &&
        (access.admin || row.kind !== "إعدادات"),
    )
    .map((x) => ({ ...x, detail: JSON.parse(x.detail) }));
  const members = store.all(
    "SELECT p.*,m.name FROM progress p JOIN members m USING(uid) ORDER BY count DESC",
  );
  const managedPaths = config.paths
    .filter((p) => access.admin || (access.operator && assigned(req.user, p)))
    .map((p) => p.id);
  res.json({
    demo,
    guild: adapter.id,
    contentEnabled: adapter.contentEnabled,
    config,
    rev,
    access,
    owner: req.user.owner,
    managedPaths,
    user: req.user.name,
    catalog,
    flags,
    audit,
    members,
    approvals: approvals(req.user, config, access),
    template: newPath("", "مسار جديد"),
  });
});
function impact(config) {
  return store
    .all("SELECT uid,name,roles FROM members")
    .filter((m) => Boolean(pending(store, config, m.uid, JSON.parse(m.roles))))
    .map((m) => ({ uid: m.uid, name: m.name }));
}
app.post("/api/settings", async (req, res) => {
  const result = await svc.serialize(async () => {
    const before = store.settings(),
      access = rights(req.user, before.config);
    const { config, rev, preview, applyNow } = req.body;
    ensure(access.admin || access.operator, "صلاحية تعديل المسارات مطلوبة");
    ensure(
      rev === before.rev,
      "الإعدادات تغيّرت. حدّث الصفحة ثم أعد التعديل",
      409,
    );
    if (!access.admin) {
      const baseline = structuredClone(before.config);
      for (const path of baseline.paths) {
        if (!assigned(req.user, path)) continue;
        const edit = config.paths.find((p) => p.id === path.id);
        if (edit) {
          path.step = edit.step;
          for (const stage of path.stages)
            stage.cost = edit.stages.find((s) => s.role === stage.role)?.cost;
        }
      }
      ensure(
        JSON.stringify(config) === JSON.stringify(baseline),
        "يمكنك تعديل أعداد الرسائل لمساراتك فقط",
      );
    }
    ensure(
      req.user.owner ||
        JSON.stringify(config.access) === JSON.stringify(before.config.access),
      "مالك السيرفر يحدد رتب تسجيل الدخول",
    );
    validate(config, await adapter.catalog(), adapter.contentEnabled);
    const affected = impact(config);
    if (preview) return { affected };
    store.tx(() => {
      store.run(
        "UPDATE settings SET body=?,rev=rev+1 WHERE id=1",
        JSON.stringify(config),
      );
      store.run("DELETE FROM approvals");
      if (applyNow) store.run("DELETE FROM deferred");
      else
        for (const m of affected)
          store.run("INSERT OR IGNORE INTO deferred VALUES(?)", m.uid);
      store.audit(req.user.uid, "إعدادات", {
        before: before.config,
        after: config,
        applyNow: Boolean(applyNow),
      });
    });
    if (applyNow)
      for (const m of affected) await svc.evaluate(m.uid).catch(svc.error);
    return { saved: true };
  });
  res.json(result);
});
app.post("/api/flags/:id", async (req, res) => {
  await svc.serialize(async () => {
    const a = rights(req.user, store.settings().config);
    ensure(a.admin || a.reviewer, "يلزم دور مراجع");
    const result = decideFlag(
      store,
      Number(req.params.id),
      req.body.action,
      req.user.uid,
      req.body.selected,
      req.body.note,
    );
    await svc.evaluate(result.uid);
  });
  res.json({ ok: true });
});
app.post("/api/approve", async (req, res) => {
  await svc.serialize(async () => {
    const { config } = store.settings(),
      a = rights(req.user, config),
      { uid, path, role } = req.body;
    ensure(
      approvals(req.user, config, a).some(
        (j) => j.uid === uid && j.path === path && j.role === role,
      ),
      "طلب غير متاح",
    );
    const live = await adapter.user(uid),
      job = pending(store, config, uid, live.roles);
    ensure(
      job?.needsApproval &&
        job.path.id === path &&
        job.state.next.role === role,
      "العضو لم يعد مستحقًا لهذه الترقية",
      409,
    );
    store.run("INSERT OR IGNORE INTO approvals VALUES(?,?,?)", uid, path, role);
    store.audit(req.user.uid, "اعتماد ترقية", { uid, path, role });
    await svc.evaluate(uid);
  });
  res.json({ ok: true });
});
app.post("/api/demo/message", async (req, res) => {
  ensure(demo, "التجربة متاحة محليًا فقط");
  const uid = req.body.kind === "staff" ? "staff-demo" : "member-demo",
    u = await adapter.user(uid);
  res.json(
    await svc.message({
      uid,
      id: randomUUID(),
      roles: u.roles,
      name: u.name,
      at: Date.now(),
      channel: req.body.channel ?? "general",
      content: String(req.body.text ?? "").slice(0, 2000),
    }),
  );
});
app.get("/api/card", async (req, res) => {
  const { config } = store.settings();
  ensure(
    Object.values(rights(req.user, config)).some(Boolean),
    "الدخول غير متاح",
  );
  const path = config.paths.find((p) => p.id === req.query.path);
  ensure(path, "اختر مسارًا", 400);
  const count = Number(req.query.count || 0);
  ensure(Number.isSafeInteger(count) && count >= 0, "عدد غير صالح", 400);
  const stages = ladder(path),
    next = stages.find((s) => s.total > count),
    current = stages.filter((s) => s.total <= count).at(-1);
  const catalog = await adapter.catalog(),
    role = (id) => catalog.roles.find((r) => r.id === id);
  res.type("png").send(
    await card({
      brand: config.brand,
      name: req.user.name,
      path: path.name,
      count,
      target: next?.total,
      next: role(next?.role)?.name,
      current: role(current?.role)?.name,
      color: role(next?.role)?.color,
    }),
  );
});
app.use((err, req, res, next) => {
  res.status(err.status ?? 400).json({ error: err.message });
});
let sweeping = false;
const timer = setInterval(async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    for (const m of store.all(
      "SELECT uid FROM members WHERE uid NOT IN (SELECT uid FROM deferred)",
    ))
      await svc.serialize(() => svc.evaluate(m.uid)).catch(svc.error);
  } finally {
    sweeping = false;
  }
}, 60000);
timer.unref();
const http = app.listen(port, host, () =>
  console.log((demo ? "Local demo" : "Madarij") + " " + origin),
);
function stop() {
  clearInterval(timer);
  http.close();
  adapter.close();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
