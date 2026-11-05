import { createHash } from "node:crypto";
import { ladder } from "./config.js";

export function activePath(store, config, uid, roles) {
  // Explicit entry paths take priority in dashboard order; linked paths inherit eligibility.
  const linked = new Set(config.paths.map((p) => p.next).filter(Boolean));
  let path = config.paths.find(
    (p) =>
      p.enabled &&
      (p.entry.some((r) => roles.includes(r)) ||
        (!p.entry.length && !linked.has(p.id))),
  );
  while (path?.next) {
    const dest = config.paths.find((p) => p.id === path.next && p.enabled);
    if (
      !dest ||
      !store.one(
        "SELECT unlocked FROM progress WHERE path=? AND uid=? AND unlocked=1",
        dest.id,
        uid,
      )
    )
      break;
    path = dest;
  }
  return path;
}

export function progress(store, uid, path) {
  const row = store.one(
    "SELECT * FROM progress WHERE uid=? AND path=?",
    uid,
    path.id,
  );
  const roles = new Set(
    store
      .all("SELECT role FROM grants WHERE uid=? AND path=?", uid, path.id)
      .map((x) => x.role),
  );
  const stages = ladder(path);
  return {
    count: row?.count ?? 0,
    last: row?.last ?? 0,
    current: stages.filter((s) => roles.has(s.role)).at(-1),
    next: stages.find((s) => !roles.has(s.role)),
  };
}

function unlockNext(store, uid, path, count) {
  if (!path.next) return;
  store.run(
    `INSERT INTO progress(uid,path,count,unlocked) VALUES(?,?,?,1)
    ON CONFLICT(uid,path) DO UPDATE SET count=CASE WHEN unlocked=0 THEN max(count,excluded.count) ELSE count END,unlocked=1`,
    uid,
    path.next,
    path.carry ? count : 0,
  );
}

export function record(store, event, config) {
  const { uid, id, channel, at, roles, name, content } = event;
  const path = activePath(store, config, uid, roles);
  if (!path || (path.channels.length && !path.channels.includes(channel)))
    return {};
  return store.tx(() => {
    if (store.one("SELECT 1 FROM events WHERE id=?", id)) return {};
    store.run(
      "INSERT OR REPLACE INTO members VALUES(?,?,?)",
      uid,
      name,
      JSON.stringify(roles),
    );
    const initialized = store.run(
      "INSERT OR IGNORE INTO progress(uid,path) VALUES(?,?)",
      uid,
      path.id,
    );
    if (initialized.changes) {
      const highest = path.stages.findLastIndex((stage) =>
        roles.includes(stage.role),
      );
      for (const stage of path.stages.slice(0, highest + 1))
        store.run(
          "INSERT OR IGNORE INTO grants VALUES(?,?,?,0)",
          uid,
          path.id,
          stage.role,
        );
    }
    const state = progress(store, uid, path);
    if (!state.next) unlockNext(store, uid, path, state.count);
    const words = content.trim().split(/\s+/u).filter(Boolean);
    const counted = Number(
      (!state.last || at - state.last >= path.cooldown * 1000) &&
        words.length >= path.minWords,
    );
    const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
    const hash =
      config.spam.enabled && config.spam.repeats && normalized
        ? createHash("sha256").update(normalized).digest("hex")
        : "";
    store.run(
      "INSERT INTO events VALUES(?,?,?,?,?,?,?)",
      id,
      uid,
      path.id,
      channel,
      at,
      hash,
      counted,
    );
    if (counted)
      store.run(
        "UPDATE progress SET count=count+1,last=? WHERE uid=? AND path=?",
        at,
        uid,
        path.id,
      );
    let flagId;
    if (config.spam.enabled) {
      const rows = store.all(
        "SELECT id,channel,hash,counted FROM events WHERE uid=? AND path=? AND at BETWEEN ? AND ? ORDER BY at",
        uid,
        path.id,
        at - config.spam.windowSeconds * 1000,
        at,
      );
      const matching = rows.filter((r) => hash && r.hash === hash);
      const duplicate =
        config.spam.repeats > 0 && matching.length >= config.spam.repeats;
      if (
        duplicate ||
        (config.spam.burst > 0 && rows.length >= config.spam.burst)
      ) {
        const reason = duplicate ? "رسائل متطابقة" : "رسائل متتابعة";
        const samples = (duplicate ? matching : rows).map(
          ({ id, channel, counted }) => ({ id, channel, counted }),
        );
        const existing = store.one(
          "SELECT * FROM flags WHERE uid=? AND path=? AND status IN ('open','hold')",
          uid,
          path.id,
        );
        if (existing) {
          const merged = new Map(
            [...JSON.parse(existing.evidence), ...samples].map((s) => [
              s.id,
              s,
            ]),
          );
          store.run(
            "UPDATE flags SET reason=?,evidence=? WHERE id=?",
            reason,
            JSON.stringify([...merged.values()]),
            existing.id,
          );
        } else {
          const res = store.run(
            "INSERT INTO flags(uid,path,reason,evidence,status,at) VALUES(?,?,?,?,?,?)",
            uid,
            path.id,
            reason,
            JSON.stringify(samples),
            config.spam.hold ? "hold" : "open",
            at,
          );
          flagId = Number(res.lastInsertRowid);
          store.audit("مدارج", "فلاق جديد", {
            uid,
            path: path.name,
            reason,
            flagId,
          });
        }
      }
    }
    return { path: path.id, counted, flagId };
  });
}

export function decideFlag(store, id, status, actor, selected, note = "") {
  if (!["clear", "exclude", "hold"].includes(status))
    throw Error("قرار غير صالح");
  return store.tx(() => {
    const flag = store.one(
      "SELECT * FROM flags WHERE id=? AND status IN ('open','hold')",
      id,
    );
    if (!flag) throw Error("تمت مراجعة الفلاق بالفعل");
    let removed = 0;
    if (status === "exclude") {
      const evidence = JSON.parse(flag.evidence);
      if (
        selected !== undefined &&
        (!Array.isArray(selected) ||
          !selected.length ||
          selected.some((id) => !evidence.some((s) => s.id === id)))
      )
        throw Error("اختر رسائل من أدلة هذه الحالة");
      for (const sample of evidence.filter(
        (s) => selected === undefined || selected.includes(s.id),
      ))
        removed += Number(
          store.run(
            "UPDATE events SET counted=0 WHERE id=? AND counted=1",
            sample.id,
          ).changes,
        );
      store.run(
        "UPDATE progress SET count=max(0,count-?) WHERE uid=? AND path=?",
        removed,
        flag.uid,
        flag.path,
      );
    }
    store.run(
      "UPDATE flags SET status=?,actor=? WHERE id=?",
      status,
      actor,
      id,
    );
    store.audit(actor, "مراجعة فلاق", {
      id,
      status,
      removed,
      note: String(note).slice(0, 500),
    });
    return { uid: flag.uid, removed };
  });
}

export function pending(store, config, uid, roles) {
  const path = activePath(store, config, uid, roles);
  if (!path) return;
  const state = progress(store, uid, path);
  if (!state.next || state.count < state.next.total) return;
  if (
    store.one(
      "SELECT 1 FROM flags WHERE uid=? AND path=? AND status='hold'",
      uid,
      path.id,
    )
  )
    return;
  if (
    path.dailyMax &&
    store.one(
      "SELECT count(*) n FROM grants WHERE uid=? AND path=? AND at>?",
      uid,
      path.id,
      Date.now() - 86400000,
    ).n >= path.dailyMax
  )
    return;
  const approved = store.one(
    "SELECT 1 FROM approvals WHERE uid=? AND path=? AND role=?",
    uid,
    path.id,
    state.next.role,
  );
  return { path, state, needsApproval: state.next.manual && !approved };
}

export function commitGrant(store, uid, path, state) {
  store.tx(() => {
    store.run(
      "INSERT INTO grants VALUES(?,?,?,?)",
      uid,
      path.id,
      state.next.role,
      Date.now(),
    );
    store.run(
      "DELETE FROM approvals WHERE uid=? AND path=? AND role=?",
      uid,
      path.id,
      state.next.role,
    );
    if (!progress(store, uid, path).next)
      unlockNext(store, uid, path, state.count);
    store.audit("مدارج", "ترقية", {
      uid,
      path: path.name,
      role: state.next.role,
      messages: state.count,
    });
  });
}
