# PATRONI 安全鞋規格查詢

部落格文章用 `<iframe>` 嵌入的查詢工具，資料由 Google 試算表維護。

## 檔案

| 路徑 | 用途 |
|---|---|
| `index.html` | 工具本體。商品資料夾在 `/* DATA-START */` 與 `/* DATA-END */` 之間，由程式產生，不要手改。 |
| `scripts/build-data.mjs` | 讀試算表 CSV、檢查、把資料寫進 `index.html`。 |
| `data/*.csv` | 最近一次抓到的試算表快照，純備查。 |
| `.github/workflows/update-data.yml` | 每小時自動跑，也可手動觸發。 |

## 資料怎麼更新

改 Google 試算表就好。每小時整點過 5 分自動同步，最多等一小時。

要立刻更新：到 **Actions** 分頁 → 左側選「更新查詢工具資料」→ 右上「Run workflow」→ 綠色按鈕。約一分鐘後上線。官網換過商品主圖的話，執行前把「重新抓所有商品圖」打勾。

## 設定試算表網址

一次性設定。到 **Settings → Secrets and variables → Actions → Variables** 新增四個：

| 名稱 | 值 |
|---|---|
| `CSV_PRODUCTS` | products 工作表的發布 CSV 網址 |
| `CSV_FEATURES` | features 工作表的發布 CSV 網址 |
| `CSV_OPTIONS` | options 工作表的發布 CSV 網址 |
| `CSV_CERTS` | certs 工作表的發布 CSV 網址 |

沒設定的話，建置程式會改讀 `data/` 裡的 CSV 快照。

## 資料壞掉會怎樣

建置前會檢查：型號不可空白或重複、型號不可含空白、必要欄位齊全、features/certs 指到的欄位要存在、至少一款上架、上架筆數不可比上次少超過兩成、不可超過一半商品沒圖。

任何一項不過就**中止、不提交**，`index.html` 保持原狀，線上繼續跑舊資料。Actions 那一次會顯示紅色失敗，點進去看得到原因。

## 嵌入部落格

```html
<iframe src="https://hfcharliezhu.github.io/2CWEB/" style="width:100%;height:88vh;min-height:520px;max-height:880px;border:0"></iframe>
```
