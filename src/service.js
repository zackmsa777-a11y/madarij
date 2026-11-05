import { pending, record, commitGrant } from "./engine.js";
import { card } from "./cards.js";

export function service(store, adapter) {
  let tail = Promise.resolve();
  function serialize(fn) {
    const job = tail.then(fn);
    tail = job.catch(() => {});
    return job;
  }
  function error(e) {
    store.audit("مدارج", "خطأ", { message: e.message });
  }
  async function send(channel, payload) {
    try {
      await adapter().notify(channel, payload);
    } catch (e) {
      error(e);
    }
  }
  async function evaluate(uid) {
    const api = adapter(),
      { config } = store.settings();
    const saved = store.one("SELECT roles FROM members WHERE uid=?", uid);
    if (!saved || !pending(store, config, uid, JSON.parse(saved.roles))) return;
    const user = await api.user(uid);
    let roles = user.roles;
    store.run(
      "UPDATE members SET roles=? WHERE uid=?",
      JSON.stringify(roles),
      uid,
    );
    // Earned stages are unique, so even zero-cooldown catch-up terminates.
    while (true) {
      const job = pending(store, config, uid, roles);
      if (!job || job.needsApproval) return;
      const { path, state } = job;
      try {
        await api.grant(uid, path, state);
      } catch (e) {
        error(e);
        return;
      }
      commitGrant(store, uid, path, state);
      const { brand, channels } = config;
      const catalog = await api.catalog();
      const role = (id) => catalog.roles.find((r) => r.id === id);
      const target = role(state.next.role);
      const name = target?.name ?? state.next.role;
      const announcement = brand.announcement
        .replaceAll("{member}", user.name)
        .replaceAll("{role}", name);
      if (channels.celebrate) {
        try {
          const png = await card({
            brand,
            name: user.name,
            path: path.name,
            count: state.count,
            current: role(state.current?.role)?.name,
            next: name,
            target: state.next.total,
            promotion: true,
            color: target?.color,
            avatar: user.avatar,
            logo: api.logo?.(),
          });
          await api.notify(channels.celebrate, {
            content: announcement,
            files: [{ attachment: png, name: "promotion.png" }],
          });
        } catch (e) {
          error(e);
          await send(channels.celebrate, { content: announcement });
        }
      }
      if (channels.log)
        await send(channels.log, {
          content: [user.name, path.name, name, state.count + " رسالة"].join(
            " · ",
          ),
        });
      roles =
        api.id === "demo"
          ? [
              ...new Set([
                ...roles.filter(
                  (r) => !path.replace || r !== state.current?.role,
                ),
                state.next.role,
              ]),
            ]
          : (await api.user(uid)).roles;
      store.run(
        "UPDATE members SET roles=? WHERE uid=?",
        JSON.stringify(roles),
        uid,
      );
    }
  }
  function message(event) {
    return serialize(async () => {
      const { config } = store.settings();
      const result = record(store, event, config);
      if (result.counted)
        store.run("DELETE FROM deferred WHERE uid=?", event.uid);
      if (result.flagId) {
        const f = store.one("SELECT * FROM flags WHERE id=?", result.flagId),
          samples = JSON.parse(f.evidence);
        const links = samples
          .slice(-3)
          .map(
            (s) =>
              "https://discord.com/channels/" +
              adapter().id +
              "/" +
              s.channel +
              "/" +
              s.id,
          );
        await send(config.channels.review, {
          content:
            "فلاق #" +
            f.id +
            " · " +
            event.name +
            " · " +
            f.reason +
            " (" +
            samples.length +
            ")\n" +
            links.join("\n"),
        });
      }
      if (
        result.path &&
        !store.one("SELECT 1 FROM deferred WHERE uid=?", event.uid)
      )
        await evaluate(event.uid);
      return result;
    });
  }
  return { serialize, message, evaluate, error };
}
