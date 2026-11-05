import {
  startMotion,
  captureRows,
  enterView,
  rankCue,
  chargeStop,
} from "./motion.js";
startMotion();
const $ = (id) => document.getElementById(id);
let state,
  config,
  selected = "",
  tab = "paths",
  dirty = false,
  bindings = [],
  previewCount = 0,
  timer;
const titles = {
  paths: "مسارات الترقيات",
  people: "تقدّم الأعضاء",
  flags: "مراجعة الفلاقات",
  settings: "إعدادات السيرفر",
  audit: "سجل النشاط",
};
const icons = {
  paths: "M3 19h6v-5h6V9h6",
  people:
    "M3 21v-3a6 6 0 0 1 12 0v3 M14 5a4 4 0 0 1 0 8 M17 15q4 1 4 6 M12 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  flags: "M5 22V3q4-3 8 0t8 0v10q-4 3-8 0t-8 0",
  settings: "M3 6h18M3 12h18M3 18h18M8 3v6M17 9v6M10 15v6",
  audit: "M4 4h15v17H4zM8 9h7M8 14h7",
};
const shortTitles = {
  paths: "المسارات",
  people: "الأعضاء",
  flags: "الفلاقات",
  settings: "الإعدادات",
  audit: "السجل",
};
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const svg = (key) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
  icons[key] +
  '"/></svg>';
const role = (id) => state.catalog.roles.find((r) => r.id === id);
const numberFormat = new Intl.NumberFormat("ar", { numberingSystem: "arab" });
const fmt = (n) => numberFormat.format(n);
const time = (n) => new Date(n).toLocaleString("ar");
const path = () => config.paths.find((p) => p.id === selected);
function toast(s) {
  $("toast").textContent = s;
  $("toast").className = "visible";
  clearTimeout(timer);
  timer = setTimeout(() => ($("toast").className = ""), 3700);
}
async function api(url, body) {
  const r = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "تعذّر إكمال الطلب");
  return data;
}
async function reload() {
  const previousAudit = state?.audit?.[0]?.id ?? (state ? 0 : undefined);
  state = await api("/api/state");
  config = structuredClone(state.config);
  dirty = false;
  if (!path())
    selected =
      config.paths.find((p) => p.id === "members")?.id ??
      config.paths[0]?.id ??
      "";
  render();
  const grant =
    previousAudit === undefined
      ? null
      : state.audit.find((a) => a.id > previousAudit && a.kind === "ترقية");
  if (grant) {
    const r = role(grant.detail.role);
    rankCue({
      name: r?.name ?? grant.detail.role,
      color: r?.color,
      description:
        "ترقية · " +
        (state.members.find((m) => m.uid === grant.detail.uid)?.name ??
          grant.detail.path),
    });
  }
}
function mark() {
  dirty = true;
  document.querySelector("#save")?.removeAttribute("disabled");
}
function bind(fn) {
  bindings.push(fn);
  return bindings.length - 1;
}
function button(label, fn, cls = "") {
  return (
    '<button class="' +
    cls +
    '" data-action="' +
    bind(fn) +
    '">' +
    esc(label) +
    "</button>"
  );
}
function numberField(title, inputId, value, attrs, min = 0, placeholder = "") {
  const disabled = attrs.includes("disabled") ? "disabled" : "";
  const arrows = [
    ["1", "زيادة", "m2 8 4-4 4 4"],
    ["-1", "خفض", "m2 4 4 4 4-4"],
  ]
    .map(
      ([step, label, d]) =>
        `<button type="button" data-step="${step}" aria-controls="${inputId}" aria-label="${label} ${esc(title)}" ${disabled}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="${d}"/></svg></button>`,
    )
    .join("");
  return `<div class="field numeric"><label for="${inputId}">${esc(title)}</label><div class="number-box"><input id="${inputId}" type="number" inputmode="numeric" min="${min}" step="1" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs}><div class="step-arrows">${arrows}</div></div></div>`;
}
function field(title, obj, key, type = "text", items = null, disabled = false) {
  const v = obj[key],
    id = bind((el) => {
      const value =
        type === "checkbox"
          ? el.checked
          : type === "number"
            ? el.value === "" && key === "cost"
              ? null
              : Number(el.value)
            : el.value;
      obj[key] = value;
      mark();
      refreshPreview();
    });
  const attrs = ' data-field="' + id + '" ' + (disabled ? "disabled" : "");
  if (type === "number")
    return numberField(
      title,
      "quantity-" + id,
      v,
      attrs,
      ["cost", "step", "windowSeconds"].includes(key) ? 1 : 0,
      key === "cost" ? "من الفئة" : "",
    );
  let control;
  if (items)
    control =
      "<select" +
      attrs +
      ">" +
      items
        .map(
          ([value, label]) =>
            '<option value="' +
            esc(value) +
            '" ' +
            (value === v ? "selected" : "") +
            ">" +
            esc(label) +
            "</option>",
        )
        .join("") +
      "</select>";
  else if (type === "checkbox")
    control = '<input type="checkbox"' + attrs + (v ? " checked" : "") + ">";
  else
    control =
      '<input type="' + type + '" value="' + esc(v) + '" ' + attrs + ">";
  return (
    '<label class="field"><span>' +
    esc(title) +
    "</span>" +
    control +
    "</label>"
  );
}
function multi(title, obj, key, items, disabled = false) {
  return (
    '<div class="field"><span>' +
    esc(title) +
    '</span><div class="checks">' +
    items
      .map((i) => {
        const id = bind((el) => {
          obj[key] = el.checked
            ? [...obj[key], i.id]
            : obj[key].filter((v) => v !== i.id);
          mark();
        });
        return (
          '<label><input type="checkbox" data-field="' +
          id +
          '" ' +
          (obj[key].includes(i.id) ? "checked" : "") +
          " " +
          (disabled ? "disabled" : "") +
          "> " +
          esc(i.name) +
          "</label>"
        );
      })
      .join("") +
    "</div></div>"
  );
}
function panel(title, body) {
  return (
    '<section class="panel"><h2>' + esc(title) + "</h2>" + body + "</section>"
  );
}
function details(title, body) {
  return "<details><summary>" + esc(title) + "</summary>" + body + "</details>";
}
function empty(s) {
  return '<p class="empty">' + esc(s) + "</p>";
}
function grid(...parts) {
  return '<div class="grid">' + parts.join("") + "</div>";
}
function redrawEdit(fn) {
  fn();
  mark();
  render();
}
function move(list, index, direction) {
  const j = index + direction;
  if (j >= 0 && j < list.length)
    [list[index], list[j]] = [list[j], list[index]];
}
function render() {
  const previousRows = captureRows();
  bindings = [];
  document.title = config.brand.name + " · " + titles[tab];
  $("brand").textContent = config.brand.name;
  $("guild").innerHTML =
    esc(state.catalog.name) +
    "<small>" +
    (state.demo ? "بيئة التجربة المحلية" : "سيرفر ديسكورد") +
    "</small>";
  $("account").innerHTML =
    esc(state.user) +
    (state.demo
      ? ""
      : button("تسجيل الخروج", async () => {
          await fetch("/logout", { method: "POST" });
          location.reload();
        }));

  $("heading").textContent = titles[tab];
  $("nav").innerHTML = Object.keys(titles)
    .filter((k) => k !== "flags" || state.access.admin || state.access.reviewer)
    .map(
      (k) =>
        '<button aria-label="' +
        esc(titles[k]) +
        '" aria-current="' +
        (k === tab ? "page" : "false") +
        '" class="' +
        (k === tab ? "active" : "") +
        '" data-action="' +
        bind(() => {
          tab = k;
          render();
        }) +
        '">' +
        svg(k) +
        '<span class="nav-full">' +
        esc(titles[k]) +
        '</span><span class="nav-short">' +
        esc(shortTitles[k]) +
        "</span>" +
        "</button>",
    )
    .join("");
  $("actions").innerHTML =
    state.access.admin || state.access.operator
      ? '<button id="save" class="primary" ' +
        (!dirty ? "disabled" : "") +
        ">معاينة وحفظ</button>"
      : "";
  if ($("save"))
    $("save").onclick = () => previewSave().catch((e) => toast(e.message));
  $("body").innerHTML = {
    paths: pathsPage,
    people: peoplePage,
    flags: flagsPage,
    settings: settingsPage,
    audit: auditPage,
  }[tab]();
  refreshPreview();
  enterView(tab + "/" + (tab === "paths" ? selected : ""), previousRows);
}
const amounts = (p) => {
  let sum = 0;
  return p.stages.map((s) => (sum += s.cost ?? p.step));
};
function refreshPreview() {
  const p = path();
  if (!p || !$("live")) return;
  const totals = amounts(p),
    i = totals.findIndex((x) => x > previewCount),
    target = totals[i];
  $("live").innerHTML = p.stages.length
    ? `<p class="sim-result">${target ? "الرتبة التالية" : "آخر رتبة"}</p><strong>${esc(role(p.stages[i < 0 ? p.stages.length - 1 : i].role)?.name ?? "اختر رتبة")}</strong>
    <progress aria-label="تقدّم العضو" value="${Math.min(previewCount, target || 1)}" max="${target || 1}"></progress>
    <p>${target ? "باقي " + fmt(target - previewCount) + " رسالة" : "اكتمل المسار"}</p>`
    : "أضف مرحلة لتجربة التقدّم.";
  const track = $("milestones");
  if (track) {
    track.innerHTML = p.stages
      .map((stage, index) => {
        const rank = role(stage.role);
        const reached = previewCount >= totals[index];
        return `<button class="stop ${reached ? "reached" : ""}" data-milestone="${index}" style="--role:${esc(rank?.color || "#a7bdcf")}" aria-label="محاكاة ${esc(rank?.name || "المرحلة")} عند ${totals[index]} رسالة"><i></i><bdi>${esc(rank?.name || "اختر رتبة")}</bdi><small>${fmt(totals[index])} رسالة</small></button>`;
      })
      .join("");
  }
  document
    .querySelectorAll("[data-total]")
    .forEach((el) => (el.textContent = fmt(totals[Number(el.dataset.total)])));
}
function pathsPage() {
  const admin = state.access.admin;
  let html =
    '<div class="switches">' +
    config.paths
      .map((p) =>
        button(
          p.name,
          () => {
            selected = p.id;
            render();
          },
          p.id === selected ? "chosen" : "",
        ),
      )
      .join("") +
    (admin
      ? button("＋ إضافة مسار", () =>
          redrawEdit(() => {
            const p = {
              ...structuredClone(state.template),
              id: crypto.randomUUID(),
            };
            config.paths.push(p);
            selected = p.id;
          }),
        )
      : "") +
    "</div>";
  const p = path();
  if (!p) return html + empty("أضف مسارًا واختر رتب السيرفر لبدء الإعداد.");
  const noAdmin = !admin,
    canEdit = admin || state.managedPaths.includes(p.id);
  const roleItems = state.catalog.roles.map((r) => [
    r.id,
    r.name + (r.editable ? "" : " · يتعذّر منحها"),
  ]);
  const stages = p.stages
    .map((s, i) => {
      const tone = role(s.role)?.color || "#b7c8d8";
      const controls = admin
        ? details(
            "ترتيب وحذف",
            '<div class="actions">' +
              button("تقديم", () => redrawEdit(() => move(p.stages, i, -1))) +
              button("تأخير", () => redrawEdit(() => move(p.stages, i, 1))) +
              button(
                "حذف المرحلة",
                () => redrawEdit(() => p.stages.splice(i, 1)),
                "danger",
              ) +
              "</div>",
          )
        : "";
      return `<div class="stage" style="--tone:${esc(tone)}">
      <div class="rank">${field("رتبة الترقية", s, "role", "text", [["", "اختر رتبة"], ...roleItems], noAdmin)}</div>
      ${field("استثناء عدد الرسائل", s, "cost", "number", null, !canEdit)}
      <span class="target" data-total="${i}"></span>
      ${field("تحتاج اعتمادًا يدويًا", s, "manual", "checkbox", null, noAdmin)}
      ${controls}</div>`;
    })
    .join("");
  const base = field(
    "عدد الرسائل لكل مرحلة في الفئة",
    p,
    "step",
    "number",
    null,
    !canEdit,
  );
  html += `<section class="route"><div class="section-head"><div class="route-name"><h2>${esc(p.name)}</h2><span class="status" data-enabled="${p.enabled}">${p.enabled ? "مفعّل" : "متوقّف"}</span></div><small>${fmt(p.stages.length)} مراحل</small></div>
    <div id="milestones" aria-label="اختيار عتبة للمحاكاة"></div></section>`;
  const editor = `<section class="editor"><h2>قواعد الترقية</h2><div class="base">${base}<small>يسري على كل مرحلة ما لم تحدّد استثناءً.</small></div>
    <div class="stage-head" aria-hidden="true"><span>رتبة الترقية</span><span>استثناء الرسائل</span><span>الهدف التراكمي</span><span>اعتماد يدوي</span><span></span></div>
    ${stages}${admin ? button("إضافة مرحلة", () => redrawEdit(() => p.stages.push({ role: "", cost: null, manual: false })), "add-stage") : ""}</section>`;
  const sample =
    `<section class="simulator"><h2>محاكاة التقدّم</h2>${numberField("جرّب عدد الرسائل", "simCount", previewCount, "")}<div id="live" class="sample"></div>` +
    button(
      "عرض بطاقة PNG المحفوظة",
      () => {
        if (dirty) throw Error("احفظ المسار أولًا لمعاينة بطاقته");
        window.open(
          "/api/card?path=" +
            encodeURIComponent(p.id) +
            "&count=" +
            previewCount,
          "_blank",
          "noopener",
        );
      },
      "png-link",
    ) +
    "</section>";
  html += '<div class="workspace">' + editor + sample + "</div>";
  html += details(
    "الدخول والأولوية ومسار التخرج",
    grid(
      field("اسم المسار", p, "name", "text", null, noAdmin),
      field("تفعيل المسار", p, "enabled", "checkbox", null, noAdmin),
      field(
        "بعد الاكتمال",
        p,
        "next",
        "text",
        [
          ["", "إنهاء المسار"],
          ...config.paths
            .filter((x) => x.id !== p.id)
            .map((x) => [x.id, x.name]),
        ],
        noAdmin,
      ),
      field("نقل الرصيد للمسار التالي", p, "carry", "checkbox", null, noAdmin),
      field(
        "استبدال رتبة المرحلة السابقة",
        p,
        "replace",
        "checkbox",
        null,
        noAdmin,
      ),
    ) +
      multi(
        "رتب الدخول · فارغ لجميع الأعضاء، أو لدخول مسار مرتبط",
        p,
        "entry",
        state.catalog.roles,
        noAdmin,
      ) +
      multi(
        "رتب مسؤولي هذا المسار · فارغ لكل مسؤولي الترقيات",
        p,
        "managerRoles",
        state.catalog.roles,
        noAdmin,
      ) +
      (admin
        ? '<div class="actions">' +
          button("رفع أولوية المسار", () =>
            redrawEdit(() => move(config.paths, config.paths.indexOf(p), -1)),
          ) +
          button("خفض الأولوية", () =>
            redrawEdit(() => move(config.paths, config.paths.indexOf(p), 1)),
          ) +
          button(
            "حذف المسار",
            () => {
              if (window.confirm("حذف المسار من المسودة؟"))
                redrawEdit(() => {
                  config.paths = config.paths.filter((x) => x.id !== p.id);
                  selected = config.paths[0]?.id ?? "";
                });
            },
            "danger",
          ) +
          "</div>"
        : ""),
  );
  html += details(
    "شروط احتساب الرسائل",
    grid(
      field("مهلة العد بالثواني", p, "cooldown", "number", null, noAdmin),
      field("أقل عدد كلمات", p, "minWords", "number", null, noAdmin),
      field(
        "أقصى ترقيات في 24 ساعة · 0 بلا حد",
        p,
        "dailyMax",
        "number",
        null,
        noAdmin,
      ),
    ) +
      multi(
        "الرومات المحسوبة · فارغ لكل الرومات المرئية",
        p,
        "channels",
        state.catalog.channels,
        noAdmin,
      ),
  );
  return html;
}
function settingsPage() {
  const c = config,
    b = c.brand,
    d = !state.access.admin;
  const chan = [
    ["", "غير محدد"],
    ...state.catalog.channels.map((x) => [x.id, "# " + x.name]),
  ];
  return (
    '<div class="sheet">' +
    panel(
      "الهوية وبطاقات PNG",
      grid(
        ...[
          ["اسم البوت", "name"],
          ["المطوّر", "credit"],
          ["صاحب الفكرة", "idea"],
          ["عنوان بطاقة التقدّم", "progressTitle"],
          ["عنوان بطاقة الترقية", "promotionTitle"],
          ["نص التهنئة · {member} و {role}", "announcement"],
        ].map(([l, k]) => field(l, b, k, "text", null, d)),
        ...["accent", "background", "text"].map((k, i) =>
          field(["لون التمييز", "الخلفية", "النص"][i], b, k, "color", null, d),
        ),
        field("صورة العضو", b, "showAvatar", "checkbox", null, d),
        field("شعار السيرفر", b, "showLogo", "checkbox", null, d),
      ),
    ) +
    panel(
      "وجهات الإرسال",
      grid(
        ...Object.keys(c.channels).map((k, i) =>
          field(
            ["روم التهاني", "روم السجل", "روم الفلاقات الخاص"][i],
            c.channels,
            k,
            "text",
            chan,
            d,
          ),
        ),
      ),
    ) +
    panel(
      "اكتشاف السبام",
      grid(
        field("تشغيل الرصد", c.spam, "enabled", "checkbox", null, d),
        field(
          "نافذة الرصد بالثواني",
          c.spam,
          "windowSeconds",
          "number",
          null,
          d,
        ),
        field(
          "حد تدفّق الرسائل · 0 لتعطيله",
          c.spam,
          "burst",
          "number",
          null,
          d,
        ),
        field(
          "حد الرسائل المتطابقة · 0 لتعطيله",
          c.spam,
          "repeats",
          "number",
          null,
          d,
        ),
        field(
          "تعليق الترقية عند الاشتباه",
          c.spam,
          "hold",
          "checkbox",
          null,
          d,
        ),
      ),
    ) +
    panel(
      "رتب تسجيل الدخول",
      Object.entries({
        admin: "مدير النظام",
        operator: "مسؤول الترقيات",
        reviewer: "مراجع الفلاقات",
        viewer: "مشاهد السجل",
      })
        .map(([k, label]) =>
          multi(label, c.access, k, state.catalog.roles, d || !state.owner),
        )
        .join(""),
    ) +
    panel(
      "فحص صلاحيات البوت",
      "<p>إدارة الرتب · " +
        (state.catalog.manageRoles ? "متاحة" : "مطلوبة") +
        "</p><p>قراءة محتوى الرسائل · " +
        (state.contentEnabled ? "مفعّلة" : "معطّلة") +
        "</p>" +
        state.catalog.channels
          .map(
            (ch) =>
              '<div class="row"><strong># ' +
              esc(ch.name) +
              "</strong><br><small>" +
              ["view", "send", "attach", "history"]
                .map(
                  (k, i) =>
                    (ch[k] ? "✓ " : "× ") +
                    ["الرؤية", "الإرسال", "إرفاق PNG", "السجل"][i],
                )
                .join("　") +
              "</small></div>",
          )
          .join(""),
    ) +
    "</div>"
  );
}
function peoplePage() {
  const demo = state.demo
    ? panel(
        "إرسال رسالة تجريبية",
        '<div class="grid"><label class="field"><span>فئة العضو</span><select id="kind"><option value="member">عضو</option><option value="staff">ستاف</option></select></label><label class="field"><span>الروم</span><select id="channel">' +
          state.catalog.channels
            .map(
              (c) =>
                '<option value="' +
                esc(c.id) +
                '">' +
                esc(c.name) +
                "</option>",
            )
            .join("") +
          '</select></label><label class="field"><span>الرسالة</span><input id="message" value="رسالة تجربة"></label></div>' +
          button("محاكاة رسالة", async () => {
            ensureSaved();
            const r = await api("/api/demo/message", {
              kind: $("kind").value,
              channel: $("channel").value,
              text: $("message").value,
            });
            await reload();
            toast(r.counted ? "تم احتساب الرسالة" : "لم تستوفِ شروط العد");
          }),
      )
    : "";
  return (
    demo +
    panel(
      "ترقيات تنتظر الموافقة",
      state.approvals
        .map(
          (a) =>
            '<div class="row">' +
            esc(a.name) +
            " · " +
            esc(role(a.role)?.name) +
            " " +
            button("اعتماد الترقية", async () => {
              ensureSaved();
              await api("/api/approve", a);
              await reload();
            }) +
            "</div>",
        )
        .join("") || empty("لا توجد ترقيات تنتظر الاعتماد."),
    ) +
    panel(
      "تقدّم الأعضاء",
      state.members
        .map(
          (m) =>
            '<div class="row section-head"><strong>' +
            esc(m.name) +
            "</strong><span>" +
            esc(config.paths.find((x) => x.id === m.path)?.name ?? m.path) +
            "</span><span>" +
            fmt(m.count) +
            " رسالة</span></div>",
        )
        .join("") || empty("سيظهر تقدّم العضو بعد أول رسالة تدخل مساره."),
    )
  );
}
function flagsPage() {
  return panel(
    "حالات المراجعة",
    state.flags
      .map((f) => {
        const samples = f.evidence,
          open = ["open", "hold"].includes(f.status);
        const evidence = samples
          .map((s) => {
            const link = state.demo
              ? "رسالة محاكاة " + esc(s.id)
              : '<a target="_blank" rel="noopener" href="https://discord.com/channels/' +
                esc(state.guild) +
                "/" +
                esc(s.channel) +
                "/" +
                esc(s.id) +
                '">فتح الرسالة في سياقها</a>';
            return (
              '<div class="row"><input aria-label="تحديد الرسالة للاستبعاد" type="checkbox" data-flag="' +
              f.id +
              '" value="' +
              esc(s.id) +
              '" ' +
              (open && s.counted ? "checked" : "disabled") +
              "> " +
              link +
              "</div>"
            );
          })
          .join("");
        const review = async (action) => {
          ensureSaved();
          const selected = [
            ...document.querySelectorAll(
              'input[data-flag="' + f.id + '"]:checked',
            ),
          ].map((el) => el.value);
          if (
            action === "exclude" &&
            (!selected.length ||
              !window.confirm(
                "خصم " + fmt(selected.length) + " رسائل محددة من رصيد العضو؟",
              ))
          )
            return;
          await api("/api/flags/" + f.id, {
            action,
            selected,
            note: $("note-" + f.id).value,
          });
          await reload();
        };
        const controls = open
          ? '<label class="field"><span>سبب القرار</span><input id="note-' +
            f.id +
            '" maxlength="500"></label><div class="actions">' +
            [
              ["clear", "نشاط طبيعي"],
              ["hold", "تعليق الترقية"],
              ["exclude", "استبعاد الرسائل المحددة"],
            ]
              .map(([action, l]) => button(l, () => review(action)))
              .join("") +
            "</div>"
          : "";
        const status = {
          open: "بانتظار المراجعة",
          hold: "الترقية معلّقة",
          clear: "نشاط طبيعي",
          exclude: "تم الاستبعاد",
        };
        return (
          '<div class="row"><div class="section-head"><strong>' +
          esc(f.reason) +
          "</strong><span>#" +
          f.id +
          "</span></div><p>" +
          esc(state.members.find((m) => m.uid === f.uid)?.name ?? f.uid) +
          " · " +
          fmt(samples.length) +
          " رسائل · " +
          esc(status[f.status]) +
          "</p><small>" +
          time(f.at) +
          "</small>" +
          details(
            "الأدلة · " +
              fmt(samples.filter((s) => s.counted).length) +
              " رسائل محسوبة",
            evidence,
          ) +
          controls +
          "</div>"
        );
      })
      .join("") ||
      empty("لا توجد حالات اشتباه. تظهر الأدلة هنا عند تحقق شروط الرصد."),
  );
}
function auditPage() {
  return panel(
    "آخر الأحداث",
    state.audit
      .map(
        (a) =>
          '<div class="row"><div class="section-head"><strong>' +
          esc(a.kind) +
          "</strong><small>" +
          time(a.at) +
          "</small></div><small>" +
          esc(a.actor) +
          "</small>" +
          details(
            "التفاصيل",
            '<pre dir="auto">' +
              esc(JSON.stringify(a.detail, null, 2)) +
              "</pre>",
          ) +
          "</div>",
      )
      .join("") || empty("يظهر هنا سجل الترقيات والتعديلات وقرارات المراجعة."),
  );
}
function ensureSaved() {
  if (dirty) throw Error("احفظ مسودة الإعدادات أولًا");
}
async function previewSave() {
  const result = await api("/api/settings", {
    config,
    rev: state.rev,
    preview: true,
  });
  $("impact").innerHTML =
    "<p>الأعضاء المستحقون للترقية وفق الإعدادات الجديدة: <strong>" +
    fmt(result.affected.length) +
    "</strong></p><p>" +
    result.affected
      .slice(0, 8)
      .map((m) => esc(m.name))
      .join("، ") +
    '</p><label><input type="checkbox" id="applyNow"> فحص الاستحقاق فور الحفظ</label><p class="muted">إذا تركته معطّلًا، يُفحص العضو عند رسالته القادمة.</p>';
  $("confirm").showModal();
}
$("cancel").onclick = () => $("confirm").close();
$("commit").onclick = async () => {
  try {
    $("commit").disabled = true;
    await api("/api/settings", {
      config,
      rev: state.rev,
      applyNow: $("applyNow").checked,
    });
    $("confirm").close();
    await reload();
    toast("تم حفظ الإعدادات");
  } catch (e) {
    toast(e.message);
  } finally {
    $("commit").disabled = false;
  }
};
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  try {
    await bindings[Number(b.dataset.action)]();
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.hasAttribute("data-field")) bindings[Number(el.dataset.field)](el);
});
document.addEventListener("click", (e) => {
  const button = e.target.closest("[data-step]");
  if (!button || button.disabled) return;
  const input = $(button.getAttribute("aria-controls"));
  if (Number(button.dataset.step) > 0) input.stepUp();
  else input.stepDown();
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
document.addEventListener("click", (e) => {
  const stop = e.target.closest("[data-milestone]");
  if (!stop) return;
  const index = Number(stop.dataset.milestone);
  previewCount = amounts(path())[index];
  $("simCount").value = previewCount;
  refreshPreview();
  $("milestones")
    .querySelector(`[data-milestone="${stop.dataset.milestone}"]`)
    ?.focus({ preventScroll: true });
  showPreviewRank(index);
});
function showPreviewRank(index) {
  const r = role(path().stages[index]?.role);
  if (!r) return;
  chargeStop(index);
  rankCue({
    name: r.name,
    color: r.color,
    description: "محاكاة الترقية · " + fmt(previewCount) + " رسالة",
    source: $("milestones").querySelector('[data-milestone="' + index + '"] i'),
  });
}
document.addEventListener("input", (e) => {
  if (
    e.target.matches(
      'input[type="text"][data-field],input[type="number"][data-field]',
    )
  )
    bindings[Number(e.target.dataset.field)](e.target);
  if (e.target.id === "simCount") {
    const totals = amounts(path());
    const previous = previewCount;
    previewCount = Math.max(0, Number(e.target.value));
    refreshPreview();
    const index = totals.findLastIndex((n) => n <= previewCount);
    if (index >= 0 && previous < totals[index]) showPreviewRank(index);
  }
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
reload().catch((e) => {
  $("body").innerHTML =
    '<div class="panel"><p>' +
    esc(e.message) +
    '</p><a href="/login">الدخول بحساب Discord</a></div>';
});
