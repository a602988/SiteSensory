# P2 驗證摘要

日期：2026-09-17

## 結果

- `pnpm check`：exit code 0。
  - ESLint：通過。
  - TypeScript：通過。
  - Vitest：3 個測試檔通過，1 個資料庫整合測試在沒有測試資料庫時依設定略過；共 8 個測試通過。
- PostgreSQL integration test：exit code 0，1 個測試通過。
  - Migration `001-initial` 可成功套用。
  - 建立 25 張第一版資料表，所有表都有 `created_at`。
  - 修改 `created_at` 會被資料庫 trigger 拒絕。
  - 建立 13 種頁面類型與第一批受控公共分類。
  - pgvector `0.8.6` 可用。
  - Migration 可完整回滾，回滾後業務資料表不存在。
- `kysely-codegen`：從實際資料庫產生 25 張表的 `packages/database/src/types.ts`。
- 測試使用獨立 project `sitesensory-p2-smoke`。完成後已刪除測試容器、network 與 volume。

## 修正紀錄

開發電腦的 `127.0.0.1:5432` 已有另一個 PostgreSQL。SiteSensory 預設主機連接埠改為 `55432`，容器內仍使用 `5432`，避免測試與既有資料庫互相干擾。

pnpm 只允許 lockfile 中的 `esbuild` 執行安裝腳本。其他相依套件仍不能執行 build script。
