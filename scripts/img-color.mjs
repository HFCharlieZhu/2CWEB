import fs from "node:fs";
import path from "node:path";

let PNG = null, jpeg = null;
async function loaders() {
  if (PNG === null) {
    try { PNG = (await import("pngjs")).PNG; } catch { PNG = false; }
    try { jpeg = (await import("jpeg-js")).default; } catch { jpeg = false; }
  }
}

function decode(buf) {
  const isPNG = buf[0] === 0x89 && buf[1] === 0x50;
  const isJPG = buf[0] === 0xff && buf[1] === 0xd8;
  if (isPNG && PNG) { const p = PNG.sync.read(buf); return { w: p.width, h: p.height, d: p.data }; }
  if (isJPG && jpeg) { const p = jpeg.decode(buf, { useTArray: true }); return { w: p.width, h: p.height, d: p.data }; }
  return null;
}

const hex = (r, g, b) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

function px(img, x, y) {
  const i = (y * img.w + x) * 4;
  return { r: img.d[i], g: img.d[i + 1], b: img.d[i + 2], a: img.d[i + 3] };
}
const near = (a, b) => Math.abs(a.r - b.r) < 8 && Math.abs(a.g - b.g) < 8 && Math.abs(a.b - b.b) < 8;

// 取最左與最右那一欄的中點像素；兩邊一致就用它，不一致改用四角的多數決。
export function edgeColor(img) {
  const my = Math.floor(img.h / 2);
  const L = px(img, 0, my), R = px(img, img.w - 1, my);
  if (L.a < 250 || R.a < 250) return "";
  if (near(L, R)) return hex(L.r, L.g, L.b);
  const corners = [px(img, 0, 0), px(img, img.w - 1, 0), px(img, 0, img.h - 1), px(img, img.w - 1, img.h - 1)];
  if (corners.some((c) => c.a < 250)) return "";
  const tally = new Map();
  for (const c of corners) {
    const k = hex(c.r, c.g, c.b);
    tally.set(k, (tally.get(k) || 0) + 1);
  }
  const [best, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return n >= 3 ? best : hex(L.r, L.g, L.b);
}

export async function sampleAll(products, cacheFile, log) {
  await loaders();
  if (!PNG && !jpeg) { log("  ! 沒有安裝 pngjs／jpeg-js，略過圖片取色"); return; }
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch {}
  let fetched = 0, failed = 0;
  for (const p of products) {
    if (p.bg || !p.img) continue;                 // 試算表填了就以它為準
    if (p.img in cache) { p.bg = cache[p.img]; continue; }
    try {
      const res = await fetch(p.img);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const img = decode(Buffer.from(await res.arrayBuffer()));
      if (!img) throw new Error("格式不支援");
      cache[p.img] = edgeColor(img);
      p.bg = cache[p.img];
      fetched++;
    } catch (e) { failed++; log(`  ! ${p.id} 取色失敗（${e.message}），用預設白底`); }
  }
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
  if (fetched || failed) log(`  圖片取色：新抓 ${fetched} 張、失敗 ${failed} 張、快取 ${Object.keys(cache).length} 筆`);
}
