// All motion is visual feedback. Data and controls update synchronously.
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const root = document.documentElement;
const running = new Set();
let paused = false;
try {
  paused = localStorage.getItem("madarij:motion") === "off";
} catch {}
let cueTimer;

function enabled() {
  return !paused && !reduced.matches && !document.hidden;
}
function syncPreference() {
  root.dataset.motion = enabled() ? "on" : "off";
  const control = document.getElementById("motion-switch");
  control.setAttribute("aria-pressed", String(enabled()));
  control.title = reduced.matches
    ? "تقليل الحركة مفعّل من النظام"
    : enabled()
      ? "تقليل الحركة"
      : "تشغيل الحركة";
  control.disabled = reduced.matches;
  if (!enabled()) {
    for (const animation of running) animation.cancel();
    clearCue();
  }
}
function clearCue() {
  clearTimeout(cueTimer);
  document.getElementById("rank-cue").replaceChildren();
  document.querySelector(".rank-flight")?.remove();
}
export function startMotion() {
  const control = document.getElementById("motion-switch");
  control.onclick = () => {
    paused = !paused;
    try {
      localStorage.setItem("madarij:motion", paused ? "off" : "on");
    } catch {}
    syncPreference();
  };
  reduced.addEventListener("change", syncPreference);
  document.addEventListener("visibilitychange", syncPreference);
  syncPreference();
}
function play(el, frames, duration, delay = 0) {
  if (!el || !enabled()) return;
  const a = el.animate(frames, {
    duration,
    delay,
    easing: "cubic-bezier(.16,1,.3,1)",
  });
  running.add(a);
  a.finished.then(
    () => running.delete(a),
    () => running.delete(a),
  );
  return a;
}
// Follow the actual connector, including its RTL order and horizontal scroll.
function trace(track, from, to, color, delay = 0) {
  if (!enabled() || !from || !to) return;
  track.querySelector(".route-trace")?.remove();
  const rect = track.getBoundingClientRect(),
    a = from.getBoundingClientRect(),
    b = to.getBoundingClientRect();
  const start = a.left + a.width / 2,
    end = b.left + b.width / 2;
  if (Math.abs(start - end) < 2) return;
  const bar = document.createElement("span");
  bar.className = "route-trace";
  Object.assign(bar.style, {
    left: Math.min(start, end) - rect.left + track.scrollLeft + "px",
    top: a.top + a.height / 2 - rect.top - 1 + "px",
    width: Math.abs(end - start) + "px",
    background: color,
    transformOrigin: start > end ? "right" : "left",
  });
  track.append(bar);
  const sweep = play(
    bar,
    [
      { transform: "scaleX(0)", opacity: 0.8 },
      { transform: "scaleX(1)", opacity: 0.9, offset: 0.68 },
      { transform: "scaleX(1)", opacity: 0 },
    ],
    750,
    delay,
  );
  sweep?.finished.then(
    () => bar.remove(),
    () => bar.remove(),
  );
}
export function captureRows() {
  return new Map(
    Array.from(document.querySelectorAll(".stage .rank select"), (el) => [
      el.value,
      el.closest(".stage").getBoundingClientRect().top,
    ]),
  );
}
let lastView = "";
export function enterView(key, rows) {
  if (lastView === key) {
    for (const el of document.querySelectorAll(".stage .rank select")) {
      const row = el.closest(".stage"),
        prev = rows.get(el.value);
      const dy =
        prev === undefined ? 12 : prev - row.getBoundingClientRect().top;
      if (Math.abs(dy) > 1)
        play(
          row,
          [{ transform: "translateY(" + dy + "px)" }, { transform: "none" }],
          330,
        );
    }
    return;
  }
  const first = !lastView;
  lastView = key;
  clearCue();
  play(
    document.querySelector("#heading"),
    [
      { transform: "translateX(14px)", opacity: 0.6 },
      { transform: "none", opacity: 1 },
    ],
    260,
  );
  const track = document.getElementById("milestones");
  if (track) {
    play(
      track,
      [
        { clipPath: "inset(0 0 0 94% round 8px)" },
        { clipPath: "inset(0 0 0 0 round 8px)" },
      ],
      first ? 690 : 400,
    );
    document
      .querySelectorAll(".stop i")
      .forEach((el, i) =>
        play(
          el,
          [
            { transform: "scale(.55)" },
            { transform: "scale(1.8)", offset: 0.62 },
            { transform: "none" },
          ],
          440,
          Math.min(i * 70, 260),
        ),
      );
    trace(
      track,
      track.querySelector(".stop i"),
      track.querySelector(".stop:last-of-type i"),
      "#bddbfa",
      180,
    );
    play(
      document.querySelector(".simulator"),
      [
        {
          transform: "perspective(800px) rotateY(-10deg) translateX(-12px)",
          opacity: 0.7,
        },
        { transform: "none", opacity: 1 },
      ],
      440,
    );
  }
  const list = document.querySelectorAll(
    ".stage, #body > .panel, .sheet > .panel",
  );
  Array.from(list)
    .slice(0, 9)
    .forEach((el, i) =>
      play(
        el,
        [
          { transform: "translateX(18px)", opacity: 0.65 },
          { transform: "none", opacity: 1 },
        ],
        260,
        Math.min(i * 30, 150),
      ),
    );
}
// A layered rank insignia. Its color always comes from the selected Discord role.
function crest() {
  return '<svg class="insignia" aria-hidden="true" viewBox="0 0 120 120"><g class="orbit"><circle cx="60" cy="60" r="53" fill="none" stroke="currentColor" stroke-dasharray="18 6 2 8" opacity=".5"/></g><g class="seal"><path d="m60 12 36 24v45l-36 26-36-26V36z" fill="#101820" stroke="currentColor" stroke-width="3"/><path d="m60 20 29 20v36l-29 21-29-21V40z" fill="currentColor" opacity=".2"/><path d="m38 67 22-17 22 17M38 53l22-17 22 17" fill="none" stroke="currentColor" stroke-width="7"/><path d="m51 78 9-7 9 7-9 7z" fill="currentColor"/></g></svg>';
}
export function rankCue({ name, color, description, source }) {
  clearCue();
  if (document.hidden) return;
  const host = document.getElementById("rank-cue");
  const plate = document.createElement("div");
  plate.className = "rank-plate";
  plate.style.setProperty(
    "--metal",
    /^#[a-f0-9]{6}$/i.test(color) && color !== "#000000" ? color : "#accfff",
  );
  plate.innerHTML =
    crest() +
    '<div class="rank-copy"><small></small><strong dir="auto"></strong></div>';
  plate.querySelector("strong").textContent = name;
  plate.querySelector("small").textContent = description;
  host.append(plate);
  if (enabled()) {
    if (source) flySeal(source, plate);
    for (let i = 0; i < 14; i++) {
      const spark = document.createElement("i");
      spark.className = "rank-spark";
      spark.style.setProperty("--angle", (i * 360) / 14 + "deg");
      spark.style.setProperty("--reach", 68 + (i % 3) * 14 + "px");
      plate.append(spark);
    }
  }
  cueTimer = setTimeout(clearCue, 2200);
}
function flySeal(source, plate) {
  const start = source.getBoundingClientRect(),
    end = plate.querySelector(".insignia").getBoundingClientRect();
  if (start.bottom < 0 || start.top > innerHeight) return;
  const flight = document.createElement("div");
  flight.className = "rank-flight";
  flight.setAttribute("aria-hidden", "true");
  flight.style.color = plate.style.getPropertyValue("--metal");
  flight.innerHTML = crest();
  document.body.append(flight);
  const x = start.left + start.width / 2 - 28,
    y = start.top + start.height / 2 - 28;
  const dx = end.left + end.width / 2 - 28 - x,
    dy = end.top + end.height / 2 - 28 - y;
  flight.style.left = x + "px";
  flight.style.top = y + "px";
  const anim = play(
    flight,
    [
      { transform: "scale(.38) rotate(-35deg)", opacity: 0.9 },
      {
        transform:
          "translate(" +
          dx * 0.48 +
          "px," +
          (dy * 0.42 - 55) +
          "px) scale(1.22) rotate(-12deg)",
        opacity: 1,
        offset: 0.46,
      },
      {
        transform: "translate(" + dx + "px," + dy + "px) scale(1)",
        opacity: 0,
      },
    ],
    650,
  );
  anim?.finished.then(
    () => flight.remove(),
    () => flight.remove(),
  );
}
export function chargeStop(index) {
  const stop = document.querySelector('[data-milestone="' + index + '"] i');
  const track = document.querySelector("#milestones");
  if (track && stop)
    trace(
      track,
      track.querySelector(".stop i"),
      stop,
      getComputedStyle(stop).getPropertyValue("--role"),
    );
  play(
    stop,
    [
      { transform: "scale(1)" },
      { transform: "scale(2.35)", offset: 0.45 },
      { transform: "scale(1)" },
    ],
    550,
  );
  play(
    document.querySelector("#live strong"),
    [
      { transform: "translateY(8px)", opacity: 0.4 },
      { transform: "none", opacity: 1 },
    ],
    320,
  );
}
