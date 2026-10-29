import fs from "node:fs";
import path from "node:path";

const SHEETS = {
  products: process.env.CSV_PRODUCTS || "",
  features: process.env.CSV_FEATURES || "",
  options:  process.env.CSV_OPTIONS  || "",
  certs:    process.env.CSV_CERTS    || ""
};
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const HTML = path.join(ROOT, "index.html");
const MARK_A = "/* DATA-START */";
const MARK_B = "/* DATA-END */";
const REFRESH_IMAGES = process.env.REFRESH_IMAGES === "true";

const CJK = "\\u2e80-\\u2eff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u3005\\u3007";
const RE_A = new RegExp(`([${CJK}])([A-Za-z0-9])`, "g");
const RE_B = new RegExp(`([A-Za-z0-9)\\]}%])([${CJK}])`, "g");
const RE_CJK = new RegExp(`[${CJK}]`);
const FULL = { ",": "，", ";": "；", "!": "！", "?": "？" };

function fix(s) {
  if (typeof s !== "string") return s;
  let t = s;
  for (let i = 0; i < 3; i++) {
    const n = t.replace(RE_A, "$1 $2").replace(RE_B, "$1 $2");
    if (n === t) break;
    t = n;
  }
  t = t.replace(/ {2,}/g, " ").trim();
  return [...t].map((ch, i) => {
    if (!(ch in FULL)) return ch;
    const near = (c) => !!c && RE_CJK.test(c);
    return near(t[i - 1]) || near(t[i + 1]) ? FULL[ch] : ch;
  }).join("");
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

function toObjects(rows) {
  const head = rows[0].map((h) => fix(h));
  return rows.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => { o[h] = fix((r[i] ?? "").trim()); });
    return o;
  });
}

async function grab(name) {
  const url = SHEETS[name];
  const local = path.join(ROOT, "data", `${name}.csv`);
  if (!url) {
    if (!fs.existsSync(local)) throw new Error(`${name}: 沒有設定網址，也找不到 ${local}`);
    console.log(`  ${name}: 讀本機 ${path.relative(ROOT, local)}`);
    return toObjects(parseCSV(fs.readFileSync(local, "utf8")));
  }
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  if (/<html/i.test(text.slice(0, 400))) throw new Error(`${name}: 回傳的是網頁不是 CSV，請確認發布格式選的是 csv`);
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, text);
  console.log(`  ${name}: 抓到 ${text.length} 位元組`);
  return toObjects(parseCSV(text));
}

async function ogImage(pageUrl) {
  try {
    const res = await fetch(pageUrl, { headers: { "User-Agent": "Mozilla/5.0 PATRONI-bot" } });
    const html = await res.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return m ? m[1] : "";
  } catch { return ""; }
}

const slug = (s) => s.replace(/[^\w一-鿿]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

function die(msg) { console.error("\n✗ 建置中止：" + msg + "\n  index.html 未更動，線上維持舊資料。"); process.exit(1); }

const raw = fs.readFileSync(HTML, "utf8");
const a = raw.indexOf(MARK_A), b = raw.indexOf(MARK_B);
if (a < 0 || b < 0) die(`index.html 裡找不到 ${MARK_A} / ${MARK_B} 標記`);
const prevBlock = raw.slice(a + MARK_A.length, b);
const prevCount = (prevBlock.match(/\{id:"/g) || []).length;

console.log("讀取試算表…");
const [P, F, O, C] = await Promise.all([grab("products"), grab("features"), grab("options"), grab("certs")]);

if (!P.length) die("products 一筆資料都沒有");
const head = Object.keys(P[0]);
for (const col of ["型號", "品名", "商品頁網址"]) if (!head.includes(col)) die(`products 缺少必要欄位「${col}」`);

const certCols = C.map((r) => r["對應欄位"]).filter(Boolean);
for (const c of certCols) if (!head.includes(c)) die(`certs 指到不存在的欄位「${c}」`);
const featRows = F.filter((r) => r["中文名稱"] && !/多值/.test(r["型別"] || ""));
const multiRows = F.filter((r) => /多值/.test(r["型別"] || ""));
for (const r of featRows) if (!head.includes(r["對應欄位"])) die(`features 指到不存在的欄位「${r["對應欄位"]}」`);
for (const r of multiRows) if (!head.includes(r["對應欄位"])) die(`features 多值列指到不存在的欄位「${r["對應欄位"]}」`);

const ids = P.map((r) => r["型號"]);
if (ids.some((x) => !x)) die("有資料列的型號是空的");
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dup.length) die("型號重複：" + [...new Set(dup)].join("、"));
if (ids.some((x) => /\s/.test(x))) die("型號含空白：" + ids.filter((x) => /\s/.test(x)).join("、"));

const live = P.filter((r) => String(r["上架"]).toUpperCase() !== "FALSE");
if (!live.length) die("沒有任何一款是上架狀態");
if (prevCount && live.length < prevCount * 0.8)
  die(`上架筆數從 ${prevCount} 掉到 ${live.length}，少超過兩成，疑似資料被誤刪`);

const num = (n) => parseInt(String(n).replace(/[^\d]/g, ""), 10) || 0;
const SPEC_KEYS = [["grade","安全等級"],["upper","鞋面材質"],["sole","大底"],["toe","護趾材質"],
                   ["shaft","筒高"],["weight","重量"],["width","楦寬"],["size","鞋碼範圍"]];

const feats = [];
featRows.forEach((r, i) => feats.push({
  id: "f" + (i + 1), col: r["對應欄位"], name: r["中文名稱"], code: r["英文簡稱"] || "",
  grp: r["分類"] || "", ord: num(r["顯示順序"]) || i + 1, kind: "ox"
}));
O.forEach((r, i) => {
  const parent = multiRows.find((m) => m["對應欄位"] === r["對應欄位"]);
  feats.push({
    id: "o" + (i + 1), col: r["對應欄位"], val: r["儲存格的值"], name: r["搜尋選單顯示"],
    code: r["膠囊代碼"] || "", grp: (parent && parent["分類"]) || "全鞋體",
    ord: 1000 + (num(r["顯示順序"]) || i + 1), kind: "val"
  });
});
feats.sort((x, y) => x.ord - y.ord);

const certs = C.map((r, i) => ({ id: "c" + (i + 1), col: r["對應欄位"], name: r["認證名稱"] || r["對應欄位"], ord: num(r["顯示順序"]) || i + 1 }))
               .sort((x, y) => x.ord - y.ord);

const products = [];
for (const r of live) {
  const spec = {};
  for (const [k, col] of SPEC_KEYS) spec[k] = r[col] || "";
  products.push({
    id: r["型號"], name: r["品名"] || r["型號"], series: r["系列說明"] || "",
    url: r["商品頁網址"] || "", img: r["商品圖網址"] || "", spec,
    features: feats.filter((f) => f.kind === "ox" ? r[f.col] === "O" : r[f.col] === f.val).map((f) => f.id),
    certs: certs.filter((c) => r[c.col] === "O").map((c) => c.id)
  });
}

const needImg = products.filter((p) => !p.img || /自動帶入/.test(p.img) || REFRESH_IMAGES);
if (needImg.length) {
  console.log(`抓商品圖 ${needImg.length} 筆…`);
  for (const p of needImg) {
    if (!p.url) continue;
    const u = await ogImage(p.url);
    if (u) p.img = u;
    else if (!p.img || /自動帶入/.test(p.img)) { p.img = ""; console.warn(`  ! ${p.id} 抓不到商品圖`); }
  }
}
const noImg = products.filter((p) => !p.img);
if (noImg.length > products.length * 0.5) die(`超過一半的商品沒有圖片（${noImg.length}/${products.length}）`);

const label = (f) => {
  if (!f.code) return { full: f.name, menuCode: "" };
  const dup = f.name.endsWith(" " + f.code) || f.name === f.code;
  return { full: dup ? f.name : f.name + " " + f.code, menuCode: dup ? "" : f.code };
};
const j = (v) => JSON.stringify(v);
const block = `
var SPEC_ROWS=${j(SPEC_KEYS)};
var FEATURES=${j(feats.map((f) => { const L = label(f); return { id: f.id, name: f.name, code: f.code, menu: L.menuCode, full: L.full, grp: f.grp }; }))};
var CERTS=${j(certs.map((c) => ({ id: c.id, name: c.name })))};
var PRODUCTS=${j(products)};
var DATA_BUILT=${j(new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC")};
`;
fs.writeFileSync(HTML, raw.slice(0, a + MARK_A.length) + block + raw.slice(b));

console.log(`\n✓ 完成`);
console.log(`  上架商品 ${products.length} 款（總筆數 ${P.length}，下架 ${P.length - live.length}）`);
console.log(`  功能選項 ${feats.length} 項（O/X ${featRows.length}、多值 ${O.length}）`);
console.log(`  認證 ${certs.length} 項`);
if (noImg.length) console.log(`  沒有圖片 ${noImg.length} 款：${noImg.map((p) => p.id).join("、")}`);
