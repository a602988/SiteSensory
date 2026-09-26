# SiteSensory

SiteSensory 是在本機整理與搜尋網站設計案例的工具。第一版只在開發電腦執行，不接受區域網路或公開網路連線。

產品方向與施工順序分別記錄在 [開發理念](doc/vision.md) 與 [開發計劃](doc/plan.md)。
固定 1920px 的批次擷取方式記錄在 [網頁截圖規則](doc/capture-rules.md)。

## 開發環境

- Node.js 24
- pnpm 11
- Docker Engine 與 Docker Compose v2

先建立本機環境設定：

```sh
cp .env.example .env
```

把 `.env` 內的 `POSTGRES_PASSWORD` 與 `DATABASE_URL` 密碼改成相同的本機秘密。`.env` 不會進入版控。

產生本機管理者的密碼雜湊與 session 金鑰：

```sh
LOCAL_ADMIN_PASSWORD='至少八個字元的本機密碼' pnpm auth:hash
openssl rand -hex 32
```

把兩個指令的結果分別填入 `.env` 的 `LOCAL_PASSWORD_HASH` 與 `SESSION_KEY_HEX`。再產生一組至少 32 個隨機字元的 `INTERNAL_API_KEY`，供本機 CLI 呼叫 `/internal/v1` 端點。原始密碼不寫進 `.env`。開發環境未設定 `LOCAL_PASSWORD_HASH` 時，API 暫時使用前端已預填的 `24241872`；`production` 不允許省略密碼雜湊。

安裝套件並執行基礎檢查：

```sh
pnpm install
pnpm check
```

啟動 PostgreSQL 與 pgvector：

```sh
pnpm infra:up
```

若本機 Docker 只有 `docker` 而沒有 Compose v2，可以先用單一容器啟動開發資料庫：

```sh
docker run --name sitesensory-dev-db \
    -e POSTGRES_DB=sitesensory \
    -e POSTGRES_USER=sitesensory \
    -e POSTGRES_PASSWORD=sitesensory-local-secret \
    -p 127.0.0.1:55432:5432 \
    -d pgvector/pgvector:0.8.6-pg18-bookworm
```

資料庫連接埠只綁定 `127.0.0.1`。圖片與頁面證據保存在 `var/assets/`，程式會透過 `ObjectStorage` 介面存取，不把實體路徑寫進業務資料。

執行 migration：

```sh
pnpm db:migrate
```

啟動 API 與前端：

```sh
pnpm --filter @sitesensory/api start
pnpm web:dev
```

API 預設監聽 `127.0.0.1:4100`。前端預設使用 `127.0.0.1:3000`；若連接埠被占用，Vite 會自動改用下一個可用連接埠。

從 DBCut 最新清單匯入網站設計樣本。預設最多 6 個網站；`SITE_COUNT` 可改上限，`PAGES_PER_SITE` 可改每個網站的頁數（含首頁）：

```sh
SITE_COUNT=3 PAGES_PER_SITE=2 pnpm import:dbcut
```

匯入工具會解析 DBCut 最新列表中的外部網站連結，使用固定 `1920 × 1080` 桌面設定擷取首屏與完整頁面，再透過內部 API 寫入資料表。需要先啟動 API，並設定 `INTERNAL_API_KEY`、`DATABASE_URL` 與 `ASSET_ROOT`。DBCut 文章網址寫進 `pages.discovery_source_url`。每處理完一頁就更新 `artifacts/verification/p5/dbcut-import.json`，中途停止仍看得到已完成的結果。

寫入的頁面是草稿，不會出現在公開搜尋。要發布時，對該頁面 id 送出通過 `analysisResultSchema` 的分析：

```sh
curl -X POST "http://127.0.0.1:4100/internal/v1/pages/<pageId>/analysis" \
  -H "content-type: application/json" \
  -H "x-sitesensory-key: $INTERNAL_API_KEY" \
  -d @analysis.json
```

`analysis.json` 必須包含產業／風格標籤、色彩、頁面類型證據、`motionLevel`、`aestheticScores` 與 `analysisSummary`。缺少這些欄位時 API 會拒絕，頁面維持未發布。

## 目錄

- `apps/`：API、前台與背景工作程式。
- `packages/`：共用契約、資料庫、搜尋、圖片與設定模組。
- `tools/`：開發人員與 Codex 使用的本機 CLI。
- `infra/`：本機服務設定與後續容器檔案。
- `tests/`：跨模組與端到端測試。
- `artifacts/verification/`：各施工階段的完整驗證輸出。
- `var/assets/`：不進版控的本機圖片與頁面證據。
