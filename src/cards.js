import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";
GlobalFonts.registerFromPath(
  fileURLToPath(new URL("../assets/arabic.ttf", import.meta.url)),
  "Madarij Arabic",
);

async function photo(ctx, url, x, y, size) {
  if (!url || !/^https:\/\/cdn\.discordapp\.com\//.test(url)) return;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (!res.ok) return;
    const image = await loadImage(Buffer.from(await res.arrayBuffer()));
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, 2 * Math.PI);
    ctx.clip();
    ctx.drawImage(image, x, y, size, size);
    ctx.restore();
  } catch {
    /* Keep the initials when Discord's image service is unavailable. */
  }
}
export async function card({
  brand,
  name,
  path,
  count,
  target,
  current,
  next,
  promotion = false,
  color,
  avatar,
  logo,
}) {
  const canvas = createCanvas(1000, 400),
    ctx = canvas.getContext("2d");
  const ink = color && color !== "#000000" ? color : brand.accent;
  ctx.fillStyle = brand.background;
  ctx.fillRect(0, 0, 1000, 400);
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  function line(value, x, y, size, fill = brand.text, width = 840) {
    ctx.fillStyle = fill;
    ctx.font = size + 'px "Madarij Arabic"';
    ctx.fillText(String(value), x, y, width);
  }
  ctx.fillStyle = ink;
  ctx.fillRect(984, 0, 16, 400);
  line(brand.name, 940, 62, 23, ink);
  line(promotion ? brand.promotionTitle : brand.progressTitle, 940, 125, 34);
  line(name, 940, 192, 46, brand.text, 650);
  line(
    path +
      "   ·   " +
      (promotion ? "من " : "الحالية ") +
      (current ?? "البداية") +
      (next ? (promotion ? "   إلى " : "   ·   التالية ") + next : ""),
    940,
    246,
    26,
  );
  line(
    count +
      " رسالة محسوبة" +
      (target ? "   ·   الهدف " + target : "   ·   اكتمل المسار"),
    940,
    302,
    24,
  );
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = ink;
  ctx.fillRect(60, 338, 880, 12);
  ctx.globalAlpha = 1;
  const bar = 880 * (target ? Math.min(1, count / target) : 1);
  ctx.fillRect(940 - bar, 338, bar, 12);
  if (brand.showAvatar) {
    ctx.beginPath();
    ctx.arc(125, 155, 62, 0, Math.PI * 2);
    ctx.fillStyle = ink;
    ctx.fill();
    line([...name][0] ?? "•", 146, 171, 42, brand.background);
    await photo(ctx, avatar, 63, 93, 124);
  }
  if (brand.showLogo) await photo(ctx, logo, 60, 26, 46);
  return canvas.toBuffer("image/png");
}
