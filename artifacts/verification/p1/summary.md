# P1 驗證摘要

日期：2026-09-17

## 結果

- `pnpm install`：exit code 0，建立 `pnpm-lock.yaml`。
- `pnpm check`：exit code 0。
  - ESLint：通過。
  - TypeScript：通過。
  - Vitest：1 個測試檔、4 個測試通過。
- Docker Compose `config --quiet`：exit code 0。
- PostgreSQL 與 pgvector smoke test：exit code 0。
  - `pgvector/pgvector:0.8.6-pg18-bookworm` 容器進入 healthy。
  - `CREATE EXTENSION vector` 成功。
  - 資料庫回報 pgvector 版本 `0.8.6`。
- 測試使用獨立 project `sitesensory-p1-smoke`。驗證後已刪除該測試容器、network 與 volume，未影響其他 Docker 資料。

## 修正紀錄

第一次啟動時，PostgreSQL 18 拒絕使用舊的 `/var/lib/postgresql/data` volume 掛載點。依容器錯誤訊息改成 `/var/lib/postgresql` 後，使用相同命令重新驗證通過。Smoke test 已加入掛載點檢查，避免設定退回舊路徑。

## 環境差異

目前 shell 的 Docker CLI 沒有 Compose plugin。驗證使用官方 Docker Compose v5.5.0 的暫存執行檔完成；日常執行 `pnpm infra:up` 前仍需讓 `docker compose` 可從 PATH 使用。
