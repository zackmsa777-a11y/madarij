export function defaults() {
  return {
    brand: {
      name: "مدارج",
      credit: "Rust",
      idea: "Napoleon",
      accent: "#85b9ff",
      background: "#101d32",
      text: "#f1f5ff",
      progressTitle: "تقدّم العضو",
      promotionTitle: "ترقية جديدة",
      announcement: "مبروك {member}، وصلت إلى {role}!",
      showAvatar: true,
      showLogo: true,
    },
    channels: { celebrate: "", log: "", review: "" },
    access: { admin: [], operator: [], reviewer: [], viewer: [] },
    spam: {
      enabled: false,
      windowSeconds: 60,
      burst: 15,
      repeats: 6,
      hold: false,
    },
    paths: [],
  };
}

export function newPath(id, name) {
  return {
    id,
    name,
    enabled: false,
    entry: [],
    channels: [],
    step: 100,
    cooldown: 0,
    minWords: 0,
    dailyMax: 0,
    next: "",
    carry: false,
    replace: false,
    managerRoles: [],
    stages: [],
  };
}

export function ladder(path) {
  let total = 0;
  return path.stages.map((stage) => {
    total += stage.cost ?? path.step;
    return { ...stage, total };
  });
}

export function validate(config, catalog, contentEnabled) {
  function check(value, message) {
    if (!value) throw new Error(message);
  }
  function integer(value, name, min = 0) {
    check(
      Number.isSafeInteger(value) && value >= min && value <= 1e8,
      "قيمة غير صالحة: " + name,
    );
  }
  function label(s) {
    return typeof s === "string" && s.trim().length > 0 && s.length <= 240;
  }
  function roles(ids) {
    check(
      Array.isArray(ids) &&
        new Set(ids).size === ids.length &&
        ids.every((id) => catalog.roles.some((r) => r.id === id)),
      "راجع الرتب المحددة",
    );
  }
  function channels(ids) {
    check(
      Array.isArray(ids) &&
        ids.every((id) => catalog.channels.some((c) => c.id === id)),
      "راجع الرومات المحددة",
    );
  }
  for (const k of [
    "name",
    "credit",
    "idea",
    "progressTitle",
    "promotionTitle",
    "announcement",
  ])
    check(label(config.brand[k]), "راجع نصوص الهوية");
  for (const k of ["accent", "background", "text"])
    check(/^#[0-9a-f]{6}$/i.test(config.brand[k]), "لون غير صالح");
  for (const k of ["showAvatar", "showLogo"])
    check(typeof config.brand[k] === "boolean", "راجع إعدادات الصور");
  for (const k of ["celebrate", "log", "review"])
    channels(config.channels[k] ? [config.channels[k]] : []);
  for (const k of ["admin", "operator", "reviewer", "viewer"])
    roles(config.access[k]);
  const spam = config.spam;
  for (const k of ["enabled", "hold"])
    check(typeof spam[k] === "boolean", "راجع إعدادات الفلاقات");
  integer(spam.windowSeconds, "نافذة الرصد", 1);
  integer(spam.burst, "التدفق");
  integer(spam.repeats, "التكرار");
  check(
    !spam.enabled || spam.burst || spam.repeats,
    "اختر معيارًا واحدًا للرصد",
  );
  check(
    contentEnabled || !spam.enabled || !spam.repeats,
    "فعّل Message Content لاستخدام فحص التكرار",
  );
  check(Array.isArray(config.paths), "المسارات غير صالحة");
  const ids = new Set();
  for (const path of config.paths) {
    check(
      /^[a-zA-Z0-9_-]{1,64}$/.test(path.id) && !ids.has(path.id),
      "معرّف مسار مكرر أو غير صالح",
    );
    ids.add(path.id);
    check(label(path.name), "اختر اسم المسار");
    for (const k of ["enabled", "replace", "carry"])
      check(typeof path[k] === "boolean", "راجع خيارات المسار");
    roles(path.entry);
    roles(path.managerRoles);
    channels(path.channels);
    integer(path.step, "عدد رسائل الفئة", 1);
    integer(path.cooldown, "مهلة العد");
    integer(path.dailyMax, "سقف الترقيات");
    integer(path.minWords, "عدد الكلمات");
    check(
      !path.enabled || !path.minWords || contentEnabled,
      "فعّل Message Content لعد الكلمات",
    );
    check(
      Array.isArray(path.stages) && (!path.enabled || path.stages.length),
      "أضف مرحلة للمسار المفعّل",
    );
    roles(path.stages.map((s) => s.role));
    for (const s of path.stages) {
      const role = catalog.roles.find((r) => r.id === s.role);
      check(!path.enabled || role.editable, "تعذّر منح رتبة " + role.name);
      check(typeof s.manual === "boolean", "راجع الموافقة اليدوية");
      check(!role.sensitive || s.manual, "الرتب الإدارية تتطلب موافقة يدوية");
      if (s.cost !== null) integer(s.cost, "استثناء المرحلة", 1);
    }
  }
  for (const path of config.paths) {
    const seen = new Set([path.id]);
    let next = path.next;
    while (next) {
      check(
        ids.has(next) && !seen.has(next),
        "المسار التالي غير موجود أو يُنشئ حلقة",
      );
      seen.add(next);
      next = config.paths.find((p) => p.id === next).next;
    }
  }
  return config;
}
