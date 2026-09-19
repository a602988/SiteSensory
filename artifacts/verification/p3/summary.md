# P3 驗證摘要

日期：2026-09-17

## 已完成

- 建立 Fastify localhost API 與 `/api/v1/health`。
- 建立本機管理者登入、查詢 session 與登出端點。
- 密碼使用 Node.js `scrypt` 衍生後保存，不保存原始密碼。
- session cookie 使用 `httpOnly` 與 `sameSite=strict`；第一版以 localhost HTTP 執行，因此尚未啟用 `secure`。
- 第一次登入時，在同一個 transaction 建立 `users` 與 `auth_identities`。
- 錯誤回應包含穩定錯誤碼與 Fastify request ID。
- 建立公開搜尋、頁面詳情與相似搜尋端點骨架；未完成的業務邏輯明確回傳 `501`。
- 建立收藏視角與私人標籤 CRUD API，所有查詢都從 session 取得 `user_id`。
- 建立 `/internal/v1/ingestion-jobs` 端點骨架，使用獨立的 `INTERNAL_API_KEY`，前台 `/api/v1` 沒有網址提交端點。
- Zod 是輸入驗證與 OpenAPI JSON Schema 的共同來源。

## 驗證結果

- 階段相關 lint、typecheck 與測試：exit code 0。
  - ESLint：通過。
  - TypeScript：通過。
  - API 與契約測試：4 個測試檔、11 個測試通過。
- PostgreSQL integration test：exit code 0，1 個測試通過。
  - Migration 可前進與回滾。
  - 使用者 B 無法列出、修改或刪除使用者 A 的收藏。
  - 測試使用獨立 project `sitesensory-p3-smoke`；完成後已刪除容器、network 與 volume。
- 登入測試確認錯誤密碼回傳 `401`，正確密碼可建立 session，session 可讀取並可登出。
- OpenAPI 包含公開頁面、收藏、私人標籤與內部收錄路由，且不存在前台網址提交路由。
- 非 loopback host 由環境 schema 拒絕，API 啟動程式只使用通過該 schema 的 host。

## 延後到後續階段

- 網址安全、去重、工作建立與狀態查詢由 P4 完成。
- 公開搜尋與頁面詳情的正式查詢由 P8 完成。
- 相似搜尋由 P6 與 P8 完成。
