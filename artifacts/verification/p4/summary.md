# P4 驗證摘要

日期：2026-09-18

## 完成內容

- 網址只接受 `http` 與 `https`，拒絕內嵌帳號密碼。
- 正規化主機、預設 port、fragment、尾端斜線與查詢參數；只移除具名追蹤參數，保留內容識別參數。
- DNS 查詢的每個 IPv4 與 IPv6 位址都會檢查，拒絕 loopback、private、link-local、metadata、測試保留及 multicast 網段。
- 每一段 redirect 都重新執行 DNS 與目的位址檢查。
- 相同 idempotency key 或同一個正規網址的進行中工作會重用既有工作；同一 key 搭配不同網址回傳衝突。
- PostgreSQL 使用 advisory lock 防止並發建立重複工作，使用 `FOR UPDATE SKIP LOCKED` 防止兩個 worker 領到同一工作。
- Queue 支援 lease 更新、lease 過期回收、job attempt、錯誤摘要與最多三次的可重試失敗。
- Queue 的可用時間、lease 與重試時間全部使用 PostgreSQL 時鐘，避免主機與容器時鐘差異造成工作無法立即領取。

## 驗證

- 網址安全單元測試涵蓋正規化、IDN、協定、帳密、IPv4、IPv6、metadata、redirect 轉入私網及安全 redirect。
- API 測試涵蓋內部金鑰、Zod 驗證、工作建立與前台不存在收錄端點。
- PostgreSQL 整合測試涵蓋並發網址去重、idempotency conflict、兩個 worker 並發領取、錯誤 lease、lease 過期回收及失敗重試。
- 整合測試使用獨立 Docker Compose project `sitesensory-p4-smoke`，完成後刪除容器、network 與 volume。
