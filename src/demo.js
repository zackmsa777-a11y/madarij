import { defaults, newPath } from "./config.js";
export function demoAdapter(savedRoles = () => undefined) {
  const roles = [
    ["team", "فريق الإدارة", "#e3af70"],
    ["diamond", "Diamond", "#8fdced"],
    ["gold", "Gold", "#e6bf78"],
    ["silver", "Silver", "#adc1db"],
    ["member", "Member", "#9fa9ee"],
    ["staff", "Staff", "#ce9dca"],
    ["lead", "Supervisor", "#dcc087"],
  ].map(([id, name, color]) => ({ id, name, color, editable: true }));
  const channels = ["general", "promotions", "staff-log", "review"].map(
    (id) => ({
      id,
      name: id,
      view: true,
      send: true,
      attach: true,
      history: true,
    }),
  );
  const config = defaults();
  config.channels = {
    celebrate: "promotions",
    log: "staff-log",
    review: "review",
  };
  const members = {
    ...newPath("members", "الأعضاء"),
    enabled: true,
    entry: ["member"],
    step: 100,
    stages: ["silver", "gold", "diamond"].map((role) => ({
      role,
      cost: null,
      manual: false,
    })),
  };
  const staff = {
    ...newPath("staff-track", "الطاقم"),
    enabled: true,
    entry: ["staff"],
    step: 250,
    stages: [{ role: "lead", cost: null, manual: true }],
  };
  config.paths = [staff, members];
  config.spam.enabled = true;
  return {
    initial: config,
    id: "demo",
    contentEnabled: true,
    catalog: async () => ({
      name: "استوديو مدارج",
      roles,
      channels,
      manageRoles: true,
    }),
    user: async (uid) => ({
      uid,
      name: uid === "demo-owner" ? "مدير التجربة" : "عضو التجربة",
      owner: uid === "demo-owner",
      roles: savedRoles(uid) ?? (uid === "staff-demo" ? ["staff"] : ["member"]),
    }),
    grant: async () => {},
    notify: async () => {},
    close() {},
  };
}
