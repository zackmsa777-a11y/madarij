// The hidden select retains form values and the existing change handlers.
let dismiss;
const paths = {
  channel: "M9 3 7 21M17 3l-2 18M3 9h18M2 15h18",
  role: "M12 3 20 7v6c0 4-5 7-8 9-3-2-8-5-8-9V7z",
  path: "M3 18h6v-5h6V8h6",
  select: "m6 9 6 6 6-6",
  search: "M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  check: "m4 12 5 5 11-11",
  clear: "M5 12h14",
};
function icon(type) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", paths[type]);
  svg.append(path);
  return svg;
}
function node(tag, cls, text) {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
const normalize = (s) =>
  s
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u064B-\u065F\u0640]/g, "")
    .replace(/^\s*#\s*/, "")
    .trim();
const count = (n) => n.toLocaleString("ar-u-nu-arab");
export function closePicker() {
  dismiss?.(false);
}
export function enhancePickers(root, catalog) {
  const roles = new Map(catalog.roles.map((r) => [r.id, r]));
  const channels = new Map(catalog.channels.map((c) => [c.id, c]));
  for (const select of root.querySelectorAll("select")) {
    const label = select.closest(".field").querySelector("span");
    const title = label.textContent;
    const kind =
      select.dataset.pickerType ||
      (select.id === "channel" ? "channel" : "path");
    const name = (o) =>
      kind === "channel" ? o.text.replace(/^#\s*/, "") : o.text;
    const marker = (o) => {
      const el = icon(o?.value ? kind : "clear");
      const color = kind === "role" ? roles.get(o?.value)?.color : null;
      if (color && /^#[0-9a-f]{6}$/i.test(color) && color !== "#000000")
        el.style.color = color;
      return el;
    };
    const trigger = node("button", "pick-trigger");
    trigger.type = "button";
    trigger.disabled = select.disabled;
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    // Move interactive children out of the old wrapping label.
    const parent = select.parentElement;
    if (parent.tagName === "LABEL") {
      const field = node("div", parent.className);
      parent.replaceWith(field);
      field.append(...parent.childNodes);
    }
    select.hidden = true;
    select.after(trigger);
    function sync() {
      const selected = [...select.selectedOptions];
      const text = selected.length
        ? selected.slice(0, 2).map(name).join("، ") +
          (selected.length > 2 ? " +" + count(selected.length - 2) : "")
        : "غير محدد";
      trigger.replaceChildren(
        marker(selected[0]),
        node("bdi", "pick-value", text),
        icon("select"),
      );
      trigger.setAttribute("aria-label", title + "، " + text);
    }
    sync();
    function open() {
      if (trigger.disabled) return;
      if (trigger.getAttribute("aria-expanded") === "true") {
        dismiss?.(true);
        return;
      }
      closePicker();
      const pop = node("div", "pick-pop");
      const top = node("div", "pick-heading", title.split(" · ")[0]);
      const options = [...select.options];
      top.append(
        node(
          "small",
          "pick-counter",
          count(options.filter((o) => o.value).length),
        ),
      );
      const search = node("div", "pick-search"),
        input = node("input", "");
      input.type = "text";
      input.autocomplete = "off";
      input.placeholder =
        kind === "channel"
          ? "ابحث عن روم…"
          : kind === "role"
            ? "ابحث عن رتبة…"
            : "ابحث بالاسم…";
      input.setAttribute("aria-label", input.placeholder);
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-expanded", "true");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-controls", "picker-options");
      search.append(icon("search"), input);
      const list = node("div", "pick-options");
      list.id = "picker-options";
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", title);
      if (select.multiple) list.setAttribute("aria-multiselectable", "true");
      pop.append(top, search, list);
      document.body.append(pop);
      trigger.setAttribute("aria-expanded", "true");
      trigger.setAttribute("aria-controls", list.id);
      let filtered = [],
        active = -1;
      function highlight(scroll = true) {
        for (const [i, el] of [...list.children].entries())
          el.classList.toggle("pointed", i === active && filtered.length > 0);
        const el = filtered.length ? list.children[active] : null;
        if (el) {
          input.setAttribute("aria-activedescendant", el.id);
          if (scroll) el.scrollIntoView({ block: "nearest" });
        } else input.removeAttribute("aria-activedescendant");
      }
      function draw(preferred) {
        const q = normalize(input.value);
        filtered = options.filter(
          (o) => !o.disabled && normalize(name(o)).includes(q),
        );
        list.replaceChildren();
        active = filtered.indexOf(preferred);
        if (active < 0 && filtered.length) active = 0;
        filtered.forEach((o, i) => {
          const row = node("div", "pick-option");
          row.id = "picker-option-" + i;
          row.setAttribute("role", "option");
          row.setAttribute("aria-selected", String(o.selected));
          row.append(marker(o), node("bdi", "pick-name", name(o)));
          const channel = kind === "channel" && channels.get(o.value);
          if (channel && (!channel.view || !channel.send))
            row.append(
              node(
                "small",
                "pick-note",
                !channel.view ? "الروم غير مرئي" : "الإرسال مقيّد",
              ),
            );
          if (o.selected) row.append(icon("check"));
          row.addEventListener("pointermove", () => {
            active = i;
            highlight(false);
          });
          row.addEventListener("mousedown", (e) => e.preventDefault());
          row.onclick = () => choose(o);
          list.append(row);
        });
        if (!filtered.length)
          list.append(node("p", "pick-empty", "لا توجد نتائج"));
        highlight(false);
      }
      function choose(o) {
        if (!o) return;
        if (select.multiple) o.selected = !o.selected;
        else select.value = o.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
        if (!select.multiple) dismiss(true);
        else {
          draw(o);
          input.focus({ preventScroll: true });
        }
      }
      function place() {
        if (!trigger.isConnected) {
          dismiss(false);
          return;
        }
        const r = trigger.getBoundingClientRect(),
          gap = 6,
          margin = 10;
        if (r.bottom < 0 || r.top > innerHeight) {
          dismiss(false);
          return;
        }
        const width = Math.min(Math.max(r.width, 285), innerWidth - 2 * margin);
        pop.style.width = width + "px";
        pop.style.left =
          Math.max(
            margin,
            Math.min(r.right - width, innerWidth - width - margin),
          ) + "px";
        const roomBelow = innerHeight - r.bottom - gap - margin,
          roomAbove = r.top - gap - margin;
        const up =
          roomBelow < Math.min(pop.scrollHeight, 300) && roomAbove > roomBelow;
        pop.style.maxHeight = Math.max(120, up ? roomAbove : roomBelow) + "px";
        pop.style.top =
          Math.max(
            margin,
            up ? r.top - gap - pop.offsetHeight : r.bottom + gap,
          ) + "px";
      }
      const outside = (e) => {
        if (!pop.contains(e.target) && !trigger.contains(e.target))
          dismiss(false);
      };
      const reposition = (e) => {
        if (!pop.contains(e.target instanceof Node ? e.target : null)) place();
      };
      dismiss = (restore) => {
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("focusin", outside, true);
        window.removeEventListener("scroll", reposition, true);
        window.removeEventListener("resize", place);
        pop.remove();
        trigger.removeAttribute("aria-controls");
        trigger.setAttribute("aria-expanded", "false");
        dismiss = null;
        if (restore && trigger.isConnected)
          trigger.focus({ preventScroll: true });
      };
      input.oninput = () => {
        draw();
        place();
      };
      input.onkeydown = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          dismiss(true);
          return;
        }
        if (e.key === "Tab") {
          dismiss(true);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          choose(filtered[active]);
          return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (filtered.length) {
            active =
              (active + (e.key === "ArrowDown" ? 1 : -1) + filtered.length) %
              filtered.length;
            highlight();
          }
        }
      };
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("focusin", outside, true);
      window.addEventListener("scroll", reposition, true);
      window.addEventListener("resize", place);
      draw(select.selectedOptions[0]);
      place();
      input.focus({ preventScroll: true });
      highlight();
    }
    trigger.onclick = open;
    trigger.onkeydown = (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        open();
      }
    };
  }
}
