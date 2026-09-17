# SiteSensory

SiteSensory 是在本機整理與搜尋網站設計案例的工具。第一版只在開發電腦執行，不接受區域網路或公開網路連線。

產品方向與施工順序分別記錄在 [開發理念](doc/vision.md) 與 [開發計劃](doc/plan.md)。

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
LOCAL_ADMIN_PASSWORD='至少十二個字元的本機密碼' pnpm auth:hash
openssl rand -hex 32
```

把兩個指令的結果分別填入 `.env` 的 `LOCAL_PASSWORD_HASH` 與 `SESSION_KEY_HEX`。原始密碼不寫進 `.env`。

安裝套件並執行基礎檢查：

```sh
pnpm install
pnpm check
```

啟動 PostgreSQL 與 pgvector：

```sh
pnpm infra:up
```

資料庫連接埠只綁定 `127.0.0.1`。圖片與頁面證據保存在 `var/assets/`，程式會透過 `ObjectStorage` 介面存取，不把實體路徑寫進業務資料。

## 目錄

- `apps/`：API、前台與背景工作程式。
- `packages/`：共用契約、資料庫、搜尋、圖片與設定模組。
- `tools/`：開發人員與 Codex 使用的本機 CLI。
- `infra/`：本機服務設定與後續容器檔案。
- `tests/`：跨模組與端到端測試。
- `artifacts/verification/`：各施工階段的完整驗證輸出。
- `var/assets/`：不進版控的本機圖片與頁面證據。
