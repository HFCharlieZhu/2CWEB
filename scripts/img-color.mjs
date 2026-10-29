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

// 影像裡「有內容」的範圍（扣掉背景色與透明區），回傳 {x,y,w,h} 或 null。
// 每一列／每一欄至少要有 max(2, 0.3%) 個內容像素才算，避免浮水印雜點或壓縮噪點把框撐大。
export function contentBox(img, bgHex) {
  let bg = null;
  if (bgHex && /^#[0-9a-f]{6}$/.test(bgHex)) {
    bg = { r: parseInt(bgHex.slice(1, 3), 16), g: parseInt(bgHex.slice(3, 5), 16), b: parseInt(bgHex.slice(5, 7), 16) };
  }
  const TH = 14;
  const cols = new Uint32Array(img.w), rows = new Uint32Array(img.h);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      const a = img.d[i + 3];
      let solid;
      if (a < 24) solid = false;                       // 透明＝背景
      else if (!bg) solid = true;                      // 沒有背景色（整張透明底）→ 不透明就是內容
      else solid = Math.abs(img.d[i] - bg.r) >= TH || Math.abs(img.d[i + 1] - bg.g) >= TH || Math.abs(img.d[i + 2] - bg.b) >= TH;
      if (solid) { cols[x]++; rows[y]++; }
    }
  }
  const span = (arr, len) => {
    const need = Math.max(2, Math.round(len * 0.003));
    let a = -1, b = -1;
    for (let i = 0; i < arr.length; i++) if (arr[i] >= need) { a = i; break; }
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] >= need) { b = i; break; }
    return a < 0 || b < a ? null : [a, b - a + 1];
  };
  const cx = span(cols, img.h), cy = span(rows, img.w);
  if (!cx || !cy) return null;
  return { x: cx[0], w: cx[1], y: cy[0], h: cy[1] };
}

// 把內容框換算成「剛好填滿圖框」所需的縮放與位移。
// 圖框比例固定 1020/600；回傳 f（縮放）、tx／ty（百分比，相對 img 自身寬高）。
const FRAME_A = 1020 / 600;
export function fitVars(img, bgHex) {
  const box = contentBox(img, bgHex);
  if (!box) return null;
  const Hn = 1 / FRAME_A;
  const s = Math.min(1 / img.w, Hn / img.h);
  const fRaw = 1 / Math.max((box.w * s) / 1, (box.h * s) / Hn);
  const f = Math.min(2.4, Math.max(1, fRaw));
  const dx = box.x + box.w / 2 - img.w / 2;
  const dy = box.y + box.h / 2 - img.h / 2;
  return {
    f: +f.toFixed(3),
    tx: +(-dx * s * f * 100).toFixed(2),
    ty: +((-dy * s * f) / Hn * 100).toFixed(2),
    cover: +Math.min(1, 1 / fRaw).toFixed(3)
  };
}

export async function sampleAll(products, cacheFile, log) {
  await loaders();
  if (!PNG && !jpeg) { log("  ! 沒有安裝 pngjs／jpeg-js，略過圖片取色"); return; }
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch {}
  for (const k of Object.keys(cache)) if (typeof cache[k] === "string") cache[k] = { bg: cache[k] };  // 舊格式升級
  const apply = (p, c) => { if (!p.bg) p.bg = c.bg || ""; if (c.f) { p.f = c.f; p.tx = c.tx; p.ty = c.ty; } };
  let fetched = 0, failed = 0;
  for (const p of products) {
    if (!p.img) continue;
    if (cache[p.img] && ("f" in cache[p.img] || cache[p.img].noFit)) { apply(p, cache[p.img]); continue; }
    try {
      const res = await fetch(p.img);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const img = decode(Buffer.from(await res.arrayBuffer()));
      if (!img) throw new Error("格式不支援");
      const bg = cache[p.img]?.bg ?? edgeColor(img);
      const fit = fitVars(img, bg);
      cache[p.img] = fit ? { bg, ...fit } : { bg, noFit: 1 };
      if (!fit) log(`  ! ${p.id} 找不到商品輪廓，用預設縮放`);
      apply(p, cache[p.img]);
      fetched++;
    } catch (e) { failed++; log(`  ! ${p.id} 圖片分析失敗（${e.message}），用預設白底與縮放`); }
  }
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
  if (fetched || failed) log(`  圖片分析：新抓 ${fetched} 張、失敗 ${failed} 張、快取 ${Object.keys(cache).length} 筆`);
  const zs = products.filter((p) => p.f).map((p) => `${p.id} ${p.f}×`);
  if (zs.length) log("  自動縮放：" + zs.join("、"));
}
