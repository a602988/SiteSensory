# P3 階段驗證摘要

日期：2026-09-17

## 已完成

- 建立 Fastify localhost API 與 `/api/v1/health`。
- 建立本機管理者登入、查詢 session 與登出端點。
- 密碼使用 Node.js `scrypt` 衍生後保存，不保存原始密碼。
- session cookie 使用 `httpOnly` 與 `sameSite=strict`；第一版以 localhost HTTP 執行，因此尚未啟用 `secure`。
- 第一次登入時，在同一個 transaction 建立 `users` 與 `auth_identities`。
- 錯誤回應包含穩定錯誤碼與 Fastify request ID。

## 驗證結果

- `pnpm check`：exit code 0。
  - ESLint：通過。
  - TypeScript：通過。
  - Vitest：4 個測試檔通過、1 個資料庫整合測試依設定略過；共 10 個測試通過。
- `pnpm audit --prod`：沒有已知弱點。
- 登入測試確認錯誤密碼回傳 `401`，正確密碼可建立 session，session 可讀取並可登出。

## 尚未完成

- 收錄、工作、搜尋、收藏與私人標籤端點骨架。
- OpenAPI 與 Zod 契約的一致性測試。
- 使用者之間的私人資料隔離測試。
- 從非 loopback 介面無法連線的網路驗證。

P3 尚未標成完成；以上未完成項目通過後才進入 P4。
