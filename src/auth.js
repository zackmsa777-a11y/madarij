import { randomBytes } from "node:crypto";
const random = () => randomBytes(32).toString("hex");

export function setupAuth(app, { origin, demo, adapter, env }) {
  const sessions = new Map(),
    states = new Map();
  const flags =
    "; Path=/; HttpOnly; SameSite=Lax" +
    (origin.startsWith("https:") ? "; Secure" : "");
  const cookie = (req, key) =>
    req.headers.cookie
      ?.split(/;\s*/)
      .find((c) => c.startsWith(key + "="))
      ?.slice(key.length + 1);
  function token(map, entry, ttl) {
    const id = random();
    map.set(id, { ...entry, expires: Date.now() + ttl });
    return id;
  }
  const timer = setInterval(() => {
    for (const map of [sessions, states])
      for (const [id, v] of map) if (v.expires < Date.now()) map.delete(id);
  }, 60000);
  timer.unref();
  app.use((req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin !== origin
    )
      return res.status(403).json({ error: "مصدر الطلب غير مسموح" });
    res
      .set("X-Content-Type-Options", "nosniff")
      .set("Referrer-Policy", "same-origin")
      .set("X-Frame-Options", "DENY");
    next();
  });
  app.get("/login", (req, res) => {
    if (demo) return res.redirect("/");
    const state = token(states, {}, 600000);
    res.setHeader("Set-Cookie", "mad_state=" + state + flags);
    const params = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      response_type: "code",
      scope: "identify",
      state,
      redirect_uri: origin + "/auth/callback",
    });
    res.redirect("https://discord.com/oauth2/authorize?" + params);
  });
  app.get("/auth/callback", async (req, res) => {
    const state = cookie(req, "mad_state"),
      saved = states.get(state);
    states.delete(state);
    if (
      demo ||
      !saved ||
      saved.expires < Date.now() ||
      req.query.state !== state ||
      !req.query.code
    )
      return res.status(403).send("أعد تسجيل الدخول");
    const r = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: req.query.code,
        redirect_uri: origin + "/auth/callback",
      }),
    });
    if (!r.ok) return res.status(403).send("تعذر إكمال تسجيل الدخول");
    const { access_token } = await r.json();
    const identity = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: "Bearer " + access_token },
    });
    if (!identity.ok) return res.status(403).send("تعذر التحقق من الحساب");
    const { id } = await identity.json();
    await adapter.user(id);
    res.setHeader("Set-Cookie", [
      "mad_state=; Max-Age=0" + flags,
      "mad_session=" + token(sessions, { uid: id }, 8 * 3600000) + flags,
    ]);
    res.redirect("/");
  });
  app.post("/logout", (req, res) => {
    sessions.delete(cookie(req, "mad_session"));
    res.setHeader("Set-Cookie", "mad_session=; Max-Age=0" + flags);
    res.sendStatus(204);
  });
  app.use("/api", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const s = sessions.get(cookie(req, "mad_session")),
      uid = demo ? "demo-owner" : s?.expires > Date.now() ? s.uid : null;
    if (!uid)
      return res.status(401).json({ error: "سجّل الدخول بحساب ديسكورد" });
    try {
      req.user = await adapter.user(uid);
    } catch {
      return res
        .status(403)
        .json({ error: "تعذّر التحقق من عضويتك في السيرفر" });
    }
    next();
  });
}
