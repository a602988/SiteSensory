# SiteSensory 第一版開發計劃

## 文件狀態

- 狀態：`部分可執行`
- 日期：2026-09-17
- 需求依據：[開發理念](vision.md)
- 適用範圍：只在一台開發電腦運行的第一版
- 下一個確認節點：P5 開始真實網站校正前，確認第一批測試網址

架構與第一版方向已於 2026-09-17 確認。專案骨架、資料庫、API、擷取與前端工作可以開始；圖片相似度校正及完整端到端驗收必須等第一批真實網站樣本建立後才能完成。公開部署、第三方登入及 production（正式環境）驗收不在這一版範圍內。

## 施工就緒查核

### 既有系統基線

Repository 目前只有 `doc/vision.md`，沒有程式碼、資料庫 schema（資料結構）、migration（資料庫遷移）、既有 API、背景工作、正式環境或需要搬移的舊資料。因此，本計劃不包含相容舊系統或資料搬移。

已確認的產品決策如下：

- 前台使用者不能輸入網址，也不能觸發網站擷取。
- 網址只由開發電腦上的內部收錄 API 接收。
- 所有主機連接埠只綁定 `127.0.0.1` 或 `localhost`。
- 第一版由 Codex 執行頁面理解、分類、標籤與評分。
- 同一網址不重複建立頁面；畫面明顯改版時建立新的頁面版本。
- 搜尋範圍包含網站語言、頁面類型及視覺特徵。
- 每個頁面結果都有對應圖片與可直接開啟的原始網址。
- 使用者可以框選頁面區域，以該區域搜尋相似設計並保存收藏視角。
- 收藏可以加入私人標籤與收藏原因。
- 所有正式資料都要有不可變的 `created_at`。
- 第一版不處理費用、公開註冊或第三方登入。

### 尚未阻擋基礎施工的項目

| 項目 | 類型 | 目前處理方式 | 影響階段 | 未完成時的停止行為 |
| --- | --- | --- | --- | --- |
| 第一批測試網址 | 需要產品資料 | 架構與功能先使用本機 fixture（固定測試資料）；校正前準備至少 30 個不同語言、產業與頁面類型的公開網址 | 擷取校正、AI 評估、驗收 | 不得宣告擷取品質、分類品質或相似搜尋通過 |
| 圖片向量模型 | 需要技術評估 | 保持 provider interface（供應方式介面），以真實框選樣本比較候選模型後選定 | 相似搜尋 | 可以完成介面與精確搜尋，不得凍結模型或建立正式 HNSW 索引 |
| 網站內容權利與 robots 規則 | 需要具名責任人核准 | 內部測試只使用可公開存取的網址，保存來源與擷取時間 | 對外發布 | 第一版可在內部測試，不得公開服務 |
| Codex 資料處理設定 | 需要帳號與環境證據 | 開始真實資料測試前確認實際帳號方案及資料處理設定 | AI 分析 | 未確認前只使用不含敏感資訊的公開網站 |
| 初期使用者數量 | 已有第一版預設 | 先提供單一本機帳號，資料表仍以多使用者隔離設計 | 登入與收藏 | 不阻擋施工；不得把單一帳號寫死進收藏資料 |
| 擷取畫面尺寸 | 已確認 | 第一版桌面 viewport 固定為 `1920 × 1080`、device scale factor 為 `1`，保存首屏與完整頁面；尺寸集中在設定檔 | 擷取與 UI | 不阻擋施工；新增其他尺寸時建立新的擷取設定，不覆蓋既有版本 |

### 可施工範圍

本文件確認後，下列工作可以進行：專案骨架、資料庫 schema、migration、localhost API、工作狀態機、Playwright 擷取器、Codex CLI、AI 結果契約、前台搜尋與收藏介面、精確向量搜尋介面、測試與本機 Docker Compose。

圖片模型校正、畫面差異門檻、分類準確率門檻與完整驗收必須使用真實網站樣本。缺少樣本時，相關任務停在「已實作、待校正」，不能用 fixture 結果代替。

## 技術架構

### 技術選擇

第一版使用 TypeScript monorepo（單一程式碼庫），讓前端、API、worker（背景工作程式）與 CLI 共用資料契約。套件管理使用 pnpm workspace。

| 層級 | 選擇 | 原因 |
| --- | --- | --- |
| 前端 | Vite、React、TypeScript | 第一版只在本機內部使用，採用較輕的 Vite 開發伺服器即可支援搜尋、詳情與互動式框選；`/api` 與 `/assets` 由 dev server 代理到 localhost API。 |
| API | Fastify、TypeScript、Zod、OpenAPI | 路由與前端分離，能限制 localhost，並以同一份 schema 驗證 CLI、前端與 API 資料 |
| 資料存取 | PostgreSQL、SQL migration、Kysely | 保留 SQL、transaction（交易）與 pgvector 查詢的完整控制，不讓 ORM 限制向量索引 |
| 網站擷取 | Playwright | 能保存完整頁面與指定區域圖片；官方 API 支援 full-page screenshot（完整頁面截圖）。[Playwright Screenshots](https://playwright.dev/docs/next/screenshots) |
| 圖片處理 | Sharp | 產生預覽圖、框選快取圖、圖片尺寸與基礎感知特徵 |
| 正式資料 | PostgreSQL | 保存網站、頁面、版本、分類、使用者資料、工作狀態與稽核資訊 |
| 相似搜尋 | pgvector | 第一版直接與 PostgreSQL 條件查詢組合；先做 exact search（精確搜尋），資料量與評估資料足夠後再建立 HNSW 索引。[pgvector](https://github.com/pgvector/pgvector) |
| 圖片檔案 | 本機檔案儲存與 `ObjectStorage` 介面 | 第一版把檔案保存在開發電腦；程式只依賴儲存介面，未來可新增 S3 adapter（轉接實作），不改頁面或收藏資料 |
| AI 語意分析 | Codex 加上本機 CLI | Codex 讀取受控的工作內容，輸出固定 JSON；不直接修改資料庫。OpenAI 官方也提供「建立 Codex 可使用的 CLI」使用方式。[Codex use cases](https://developers.openai.com/codex/use-cases) |
| 圖片向量 | 可替換的 embedding worker | Codex 負責理解與分類；圖片向量負責數學上的視覺近鄰搜尋，兩者不能混成同一個介面 |
| 本機運行 | Docker Compose | 統一啟動 PostgreSQL、API、worker 與 web；對主機只發布 localhost 連接埠 |

MinIO 原本列在初期架構中，但官方專案已封存，官方也說歷史 binary 不再維護。第一版因此改用本機檔案儲存與可替換介面，不把停止維護的服務放進基礎架構。[MinIO 官方 repository](https://github.com/minio/minio)

第一版不加入 Redis、Kafka、Spark、Hadoop、OpenSearch 或圖形資料庫。工作佇列先使用 PostgreSQL，以 `FOR UPDATE SKIP LOCKED` 原子領取工作。等實測證明 PostgreSQL 佇列或搜尋成為瓶頸後再拆分。

### 元件與責任邊界

```text
開發人員
  ├─ 使用內部 CLI 新增網址
  └─ 啟動 Codex 分析任務
          │
          ▼
localhost API ──────────────── Web 前台
  │                              │
  ├─ PostgreSQL                  ├─ 搜尋與頁面詳情
  ├─ 本機檔案儲存               ├─ 框選相似搜尋
  ├─ Capture worker              └─ 收藏、私人標籤與原因
  ├─ Embedding worker
  └─ Codex CLI contract
```

- API 是所有正式資料的唯一寫入入口。worker 與 CLI 不直接寫資料庫。
- Capture worker 只負責解析網址、載入頁面、擷取畫面與收集必要結構，不做發布決定。
- Codex 只回傳分析建議。API 驗證資料契約、允許值與工作版本後才保存。
- Embedding worker 只產生圖片向量，不判斷產業、語言、頁面類型或美感。
- Web 前台只操作已公開資料與目前使用者的私人資料，沒有收錄網址的入口。

### 預計目錄

```text
apps/
  api/                 localhost API 與身分驗證
  web/                 搜尋、詳情、框選與收藏介面
  capture-worker/      Playwright 擷取與圖片前處理
  embedding-worker/    圖片向量 provider 與批次工作
packages/
  contracts/           Zod schema、API DTO、狀態與錯誤碼
  database/            migration、query 與 transaction
  search/              搜尋介面、候選生成與重新排序
  image/               圖片雜湊、色彩、框選座標與預覽圖
  config/              經驗證的環境設定
tools/
  cli/                  開發人員與 Codex 使用的本機命令
infra/
  compose/              Docker Compose 與服務設定
tests/
  fixtures/             固定 HTML、圖片與 API 樣本
  e2e/                  核心流程測試
artifacts/
  verification/         測試、效能、安全與驗收證據
doc/
  vision.md
  plan.md
  acceptance.md         最終驗收時建立
```

## 核心資料流程

### 網址收錄

1. 開發人員執行 CLI，將網址與 idempotency key（冪等識別碼）送到 localhost API。
2. API 只接受 `http` 或 `https`，正規化網址，解析 DNS 並拒絕本機、私有網段、link-local（連結本地）與雲端 metadata（中繼資料）位址。
3. API 依正規網址、已知別名及重新導向結果檢查現有網站與頁面，再建立或重用收錄工作。
4. Capture worker 原子領取工作，在固定 viewport（視窗尺寸）載入頁面，保存首屏、完整頁面、最終網址、HTML 摘要與必要 DOM 結構。
5. 系統比較最近一次成功版本。差異不足時只記錄重新檢測；差異足以表示改版時建立新的頁面版本。
6. 新頁面版本建立圖片區域及 embedding 工作，並進入等待 Codex 分析狀態。
7. Codex 透過 CLI 取得工作內容，輸出固定 JSON。API 驗證後保存分析結果。
8. 通過必要欄位與品質檢查的版本才標成 `published`，進入搜尋結果。

### 內頁探索

- 從同一 registrable domain（可註冊網域）的首頁或起始頁找內部連結。
- 只接受相同網域的 `http`、`https` 連結，不追蹤登出、登入、搜尋、購物車、無限分頁、檔案下載或帶有 session token（工作階段識別碼）的網址。
- 優先擷取導覽列、頁尾及 sitemap 中的候選頁面，再依正規網址去重。
- 每個收錄工作的最大頁數、深度、逾時與允許路徑由設定控制，不能散落成程式內的 magic value（不具名固定值）。
- 首次發現的候選網址先進工作表，不直接建立公開頁面。

### Codex 分析

Codex 接收以下內容：頁面版本識別碼、最終網址、頁面標題、可見文字摘要、語言候選、導覽文字、完整頁面圖片、首屏圖片，以及系統辨識的候選區域。API 不把 cookie、authorization header（授權標頭）、原始 session 或內部路徑交給 Codex。

Codex 回傳的 JSON 包含：

- `page_type`：主要頁面類型、次要類型、判斷依據與信心程度。
- `languages`：主要語言、支援語言、各自的證據與信心程度。
- `industry`：主要產業、次要產業及理由。
- `style_tags`：受控標籤與新標籤候選分開回傳。
- `layout_features`：導覽、hero、卡片、內容欄、圖片與頁尾等結構特徵。
- `color_features`：主要色彩角色與視覺對比描述。
- `motion_level`：靜態、輕度、中度或高度動態，以及可觀察證據。
- `aesthetic_scores`：視覺層級、排版、色彩、完成度與一致性分項；每項包含理由，不只提供總分。
- `suggested_regions`：適合建立區域索引的畫面位置與用途。
- `analysis_summary`：供搜尋與詳情頁使用的短說明。

輸出 schema 必須有版本。公共分類未收錄的新標籤只進 `pending_taxonomy_terms`，不能直接污染公共搜尋。人工修正保留原始 AI 輸出，另建修正版本。

### 圖片相似搜尋

Codex 不負責直接產生可比較的圖片向量。Embedding worker 對完整頁面、系統辨識區域與使用者框選區域產生向量，並記錄模型、版本、維度與產生時間。

第一版搜尋分成兩階段：

1. 先以公開狀態、最新版本、頁面類型、語言及產業過濾，再以圖片向量找候選區域。
2. 依視覺距離、頁面用途、版面、色彩與文字特徵重新排序，排除目前頁面、重複頁面及無法顯示的版本。

建議的初始權重是視覺向量 `0.55`、頁面類型 `0.20`、版面特徵 `0.10`、色彩 `0.10`、文字語意 `0.05`。這些數值是待校正的起始設定，不是產品契約。權重必須集中在有版本的搜尋設定中，不能寫死在查詢或 UI。

資料量小時使用 exact search，建立人工評選的相似結果集合後，再比較 exact search 與 HNSW 的 recall（召回率）。沒有評估證據前不啟用近似索引，避免搜尋變快但漏掉應出現的結果。

### 框選與收藏

- 使用者在完整頁面圖片上拖曳選取框，框外顯示半透明遮罩。
- 框選座標以原始圖片寬高的 `x`、`y`、`width`、`height` 比例保存，值域都是 `0` 到 `1`。
- API 驗證座標、最小區域、所屬頁面版本及使用者權限，不能相信瀏覽器傳入的裁切結果。
- 相似搜尋可以使用暫存框選區域，不必先收藏。
- 收藏時建立獨立的 saved view（收藏視角），並可產生快取預覽圖。同一頁面能保存多個視角。
- 私人標籤與收藏原因只屬於建立者。它們不進公共標籤、公共搜尋或其他使用者的推薦資料。

## 資料模型

### 共通欄位

所有資料表都有 `id` 與不可變的 `created_at`。可修改資料另有 `updated_at`；可封存資料使用 `archived_at`；工作與版本則另外記錄開始、完成、擷取、分析及發布時間。時間一律用 UTC 的 `timestamptz` 保存。

所有外鍵都明確定義刪除行為。正式證據、頁面版本與 AI 執行紀錄不做 cascade delete（串連刪除）；私人標籤關聯等可重建資料才可跟隨父資料刪除。

### 主要資料表

| 資料表 | 重要欄位與限制 | 用途 |
| --- | --- | --- |
| `users` | `id`、`display_name`、`status`、時間欄位 | 本機帳號；資料結構保留多使用者隔離 |
| `auth_identities` | `user_id`、`provider`、`provider_subject`，組合唯一 | 第一版使用 `local`；未來第三方登入不用改收藏資料 |
| `sites` | `registrable_domain` 唯一、`name`、`industry_id` | 一個品牌或網站 |
| `site_languages` | `site_id`、`language_code`、`role`、`source`、`confidence` | 網站主要與支援語言 |
| `pages` | `site_id`、`canonical_url`、`normalized_url_hash`、`current_version_id`、`page_type_id`、`status` | 穩定的頁面身分 |
| `page_urls` | `page_id`、`normalized_url` 唯一、`kind` | 保存 canonical、redirect 與舊網址別名 |
| `page_versions` | `page_id`、`version_number`、`final_url`、`captured_at`、`status`、`content_fingerprint` | 保存每次明顯改版的畫面與證據 |
| `page_languages` | `page_version_id`、`language_code`、`role`、`source`、`confidence` | 頁面實際顯示語言 |
| `assets` | `object_key` 唯一、`sha256`、`mime_type`、`width`、`height`、`kind` | 本機圖片與原始證據索引；欄位不保存絕對檔案路徑 |
| `visual_regions` | `page_version_id`、`kind`、比例座標、`label`、`source` | 完整頁面、系統區域或可搜尋裁切區域 |
| `embedding_models` | `provider`、`model_name`、`model_version`、`dimensions`、`status` | 向量模型登錄與切換 |
| `visual_embeddings` | `visual_region_id`、`model_id`、`embedding`，組合唯一 | 圖片相似搜尋向量 |
| `analysis_runs` | `page_version_id`、`runner`、模型與提示版本、schema 版本、狀態、時間欄位 | 每次 Codex 分析的可追溯紀錄 |
| `analysis_results` | `analysis_run_id` 唯一、分類與分數 JSON、`summary` | 保留模型原始結構化輸出 |
| `page_types` | `key` 唯一、`name`、`status` | 首頁、關於我們、最新消息列表等受控分類 |
| `taxonomy_terms` | `group_key`、`key`、`name`、`status`，組合唯一 | 產業、風格、版面、色彩角色與動畫等公共分類 |
| `page_taxonomy_terms` | `page_version_id`、`term_id`、`source`、`confidence` | 頁面與公共分類關聯 |
| `pending_taxonomy_terms` | `analysis_run_id`、`group_key`、`suggested_name`、`status` | AI 建議但尚未核准的標籤 |
| `ingestion_jobs` | `idempotency_key` 唯一、輸入網址、正規網址、狀態、重試與時間欄位 | 追蹤完整收錄流程 |
| `job_attempts` | `job_id`、`stage`、`attempt_number`、狀態、錯誤碼、時間欄位 | 每次擷取、分析及向量工作的執行證據 |
| `version_comparisons` | 新舊版本、各項差異分數、規則版本、決定 | 判斷不變、待覆核或建立新版本 |
| `saved_views` | `user_id`、`page_version_id`、比例座標、`preview_asset_id`、`reason`、時間欄位 | 收藏頁面、視角與收藏原因 |
| `user_tags` | `user_id`、`name`、`normalized_name`，使用者內唯一 | 私人標籤 |
| `saved_view_tags` | `saved_view_id`、`tag_id`，組合唯一 | 一個收藏套用多個私人標籤 |
| `activity_events` | `user_id`、`event_type`、`subject_type`、`subject_id`、`schema_version`、時間欄位 | 保存搜尋、點擊、收藏與前往原站事件 |

### 關聯摘要

```text
site 1 ── * page 1 ── * page_version 1 ── * visual_region 1 ── * visual_embedding
                     │                  └── * analysis_run 1 ── 1 analysis_result
                     └── * page_url

user 1 ── * saved_view * ── 1 page_version
  │             │
  └── * user_tag *
```

### 唯一性與交易邊界

- `page_urls.normalized_url` 唯一，防止網址格式差異建立重複頁面。
- `ingestion_jobs.idempotency_key` 唯一，相同請求重送時回傳原工作。
- `page_versions(page_id, version_number)` 唯一；建立版本、資產關聯與目前版本指標在同一個 transaction 完成。
- `visual_embeddings(visual_region_id, model_id)` 唯一；模型重跑建立新的 model record，不覆蓋舊向量。
- `saved_view_tags(saved_view_id, tag_id)` 唯一，重複加標籤不產生兩筆資料。
- 發布頁面版本時，必要資產、有效分析結果與主要頁面類型必須同時存在，否則整筆發布失敗。

## 工作狀態與失敗處理

### 收錄工作狀態

| 狀態 | 可進入來源 | 下一步 | 說明 |
| --- | --- | --- | --- |
| `queued` | 建立工作 | `resolving` | 等待網址解析 |
| `resolving` | `queued`、可重試失敗 | `capturing`、`failed` | 驗證 DNS、redirect 與重複網址 |
| `capturing` | `resolving`、可重試失敗 | `comparing`、`failed` | 擷取畫面與證據 |
| `comparing` | `capturing` | `unchanged`、`embedding`、`review_required` | 判斷是否建立新版本 |
| `embedding` | `comparing` | `awaiting_analysis`、`failed` | 建立區域與圖片向量 |
| `awaiting_analysis` | `embedding`、AI 可重試失敗 | `analyzing` | 等待 Codex 領取 |
| `analyzing` | `awaiting_analysis` | `quality_check`、`failed` | Codex 工作已被領取 |
| `quality_check` | `analyzing` | `published`、`review_required` | 驗證必要欄位與品質規則 |
| `published` | `quality_check` | 終止 | 已進入搜尋 |
| `unchanged` | `comparing` | 終止 | 只更新最後檢查時間 |
| `review_required` | 比對或品質檢查 | 回到對應階段或 `rejected` | 需要人工決定 |
| `failed` | 任一執行階段 | 原階段、`rejected` | 保存可重試性與錯誤碼 |
| `rejected` | `review_required`、不可重試失敗 | 終止 | 不建立公開資料 |

狀態只能由 API service layer（服務層）透過具名 transition（狀態轉換）方法修改。資料庫以條件更新避免過期 worker 覆蓋新狀態。每次領取工作都有 lease（租約）期限；執行者中斷後，工作可在租約到期後重新領取。

### 重試規則

- DNS、連線逾時、瀏覽器暫時失敗與 Codex 工作中斷可重試。
- 無效網址、不允許的網路位置、非 `http`／`https`、明確拒絕存取及不符合 schema 的結果不能無限重試。
- 重試次數與 backoff（延遲策略）集中在設定檔，所有 worker 使用同一份規則。
- 相同工作重試沿用原 `ingestion_job`，只新增 `job_attempt`。
- 任務驗證失敗時先穩定重現、定位根因、修正並使用相同案例回驗；同一方案失敗兩次後停止重試並重新評估。

## API 契約

所有端點以 `/api/v1` 開頭，只監聽 localhost。JSON 錯誤格式固定為 `code`、`message`、`details` 與 `request_id`；對外回應不包含 stack trace（呼叫堆疊）、SQL、檔案路徑或秘密。

### 內部收錄與工作端點

| 方法與路由 | 用途 | 關鍵輸入 | 成功回應 |
| --- | --- | --- | --- |
| `POST /api/v1/ingestion-jobs` | 新增或重用收錄工作 | `url`、`idempotency_key` | `202` 與工作摘要；重送回同一工作 |
| `GET /api/v1/ingestion-jobs/:id` | 查詢工作狀態 | 工作 ID | 工作階段、狀態、錯誤摘要與時間 |
| `POST /api/v1/analysis-jobs/claim-next` | 原子領取一筆 Codex 工作 | CLI 身分與 schema 版本 | `200` 工作或 `204` 無待辦 |
| `GET /api/v1/analysis-jobs/:id/context` | 取得受控分析內容 | 工作 ID、lease token | 分析資料與短效資產位置 |
| `POST /api/v1/analysis-jobs/:id/result` | 提交 Codex JSON | lease token、schema 版本、結果 | `200` 驗證摘要與下一狀態 |
| `POST /api/v1/analysis-jobs/:id/failure` | 記錄可重試或不可重試失敗 | 錯誤碼、摘要、是否可重試 | 更新後工作摘要 |

### 搜尋與頁面端點

| 方法與路由 | 用途 | 關鍵輸入 | 成功回應 |
| --- | --- | --- | --- |
| `GET /api/v1/pages` | 篩選與搜尋公開頁面 | query、page type、language、industry、style、cursor | 頁面卡片、圖片、來源網址與下一頁 cursor |
| `GET /api/v1/pages/:id` | 顯示頁面詳情 | 頁面 ID | 最新公開版本、完整圖片、分析、來源網址及相似項目 |
| `POST /api/v1/similarity-searches` | 用整頁或框選區域找相似設計 | `page_version_id`、比例座標、filters | 相似區域、所屬頁面、分數與主要原因 |
| `GET /api/v1/taxonomies` | 取得公共篩選資料 | group | 有效公共分類及顯示順序 |

列表使用 cursor pagination（游標分頁），不使用會隨資料插入漂移的深頁 offset。圖片回應提供預覽資產位置，不把完整圖片編成 base64 放進 JSON。

### 收藏與私人標籤端點

| 方法與路由 | 用途 | 關鍵輸入 | 成功回應 |
| --- | --- | --- | --- |
| `GET /api/v1/saved-views` | 查看自己的收藏 | tag、page type、cursor | 收藏視角與頁面摘要 |
| `POST /api/v1/saved-views` | 收藏目前頁面或框選視角 | `page_version_id`、比例座標、reason、tag IDs | 新收藏 |
| `PATCH /api/v1/saved-views/:id` | 修改視角、原因或標籤 | 可修改欄位 | 更新後收藏 |
| `DELETE /api/v1/saved-views/:id` | 刪除自己的收藏 | 收藏 ID | `204` |
| `GET /api/v1/user-tags` | 取得自己的私人標籤 | cursor | 標籤與收藏數量 |
| `POST /api/v1/user-tags` | 建立私人標籤 | name | 新標籤 |
| `PATCH /api/v1/user-tags/:id` | 重新命名私人標籤 | name | 更新後標籤 |
| `DELETE /api/v1/user-tags/:id` | 刪除私人標籤 | 標籤 ID | `204`；收藏本身保留 |

所有私人端點都從登入 session 取得 `user_id`，不接受呼叫端傳入另一個使用者 ID。

### CLI 契約

```text
sitesensory ingest add --url <url> --key <idempotency-key>
sitesensory ingest status <job-id>
sitesensory ai claim --schema <version>
sitesensory ai context <analysis-job-id> --output <directory>
sitesensory ai submit <analysis-job-id> --file <result.json>
sitesensory ai fail <analysis-job-id> --code <code> --retryable
sitesensory taxonomy list --group <group>
```

CLI 預設輸出穩定 JSON，錯誤寫到 stderr 並使用非零 exit code（結束碼）。會寫入資料的命令要求明確參數，不以互動式提示取代。Codex 只能使用這組命令，不讀取資料庫連線資訊。

## 網址去重與改版判斷

### 網址正規化

正規化流程集中在單一模組，依序處理：只允許 `http`／`https`、主機名稱小寫、IDN（國際化網域名稱）標準化、移除預設連接埠、移除 fragment（片段識別碼）、統一空路徑與尾端斜線、排序保留的查詢參數、移除已確認的追蹤參數，再解析 redirect 與頁面的 canonical URL。

查詢參數不能全部刪除。產品 ID、文章 ID 或語言參數可能識別不同內容；只有集中設定的追蹤參數可以移除。canonical 只作為證據之一，若它跨網域、指向被禁止位置或與實際內容矛盾，工作進入人工檢查。

### 畫面與結構差異

每次比較保存以下特徵：圖片感知雜湊距離、縮小圖像差異、主要色彩距離、候選區域位置差異、DOM 區塊摘要差異與可見文字變化。Cookie 提示、時間、廣告與輪播圖等易變區域要能被標記並降低權重。

比較結果分成 `unchanged`、`new_version` 與 `review_required`。門檻由版本化設定管理，必須以真實網站的成對截圖校正。計劃不先寫死「差異百分比」，因為未經樣本校正的數字無法分辨內容更新與設計改版。

## 快取與檔案策略

- API 搜尋結果第一版不加 Redis。先依查詢建立資料庫索引並量測。
- 瀏覽器可快取公開預覽圖；資產 URL 包含內容 hash，檔案改變時產生新 URL，不需要主動清除舊快取。
- 框選預覽圖是可重建快取。正式依據是原始圖片、頁面版本與比例座標。
- 相似搜尋結果可以在程序記憶體短暫快取，key 必須包含頁面版本、框選座標、篩選條件、搜尋設定版本與向量模型版本。程序重啟後遺失不影響正確性。
- `ObjectStorage` 的 object key（物件鍵）不使用原始網址或使用者輸入，避免路徑穿越與資訊洩漏；使用不可預測 ID 與內容 hash。第一版檔案只能寫入設定的資產根目錄，不能接受呼叫端提供的實體路徑。

## 前端畫面與互動

### 第一版頁面

| 路由 | 主要內容 | 必備狀態 |
| --- | --- | --- |
| `/` | 搜尋框、主要分類入口、最近收錄頁面 | 載入、空資料、錯誤 |
| `/search` | 圖片卡片瀑布流、語言／頁面類型／產業／風格篩選 | 查詢中、無結果、載入更多失敗 |
| `/pages/:id` | 完整圖片、來源網址、分類、分析理由、框選工具與相似設計 | 圖片失效、來源失效、無相似結果 |
| `/saved` | 自己的收藏視角、標籤篩選與收藏原因 | 尚未收藏、標籤無結果 |
| `/tags` | 私人標籤清單及標籤版圖 | 尚無標籤、重新命名衝突 |
| `/internal/jobs` | 本機工作狀態與待人工檢查項目 | 進行中、失敗、待覆核 |

### 框選工具契約

- 支援滑鼠與觸控拖曳建立選取框。
- 選取框可以移動，四邊與四角有可操作的縮放控制點。
- 框內保持原亮度，框外使用遮罩；鍵盤可以移動與調整框選範圍。
- 顯示最小選取限制，不能建立零面積或超出圖片的範圍。
- 使用者停止拖曳後才送出搜尋，快速調整時取消過期請求。
- 搜尋中保留目前結果並顯示更新狀態，避免畫面閃空。
- 結果卡顯示候選頁面的相符區域、頁面類型、語言、主要相似原因與原始連結。
- 儲存視角前顯示實際預覽；儲存後在收藏清單顯示相同區域。

前端開始施工前先建立設計 token（設計變數）、桌面與窄螢幕線框，以及框選工具的載入、錯誤、空資料、拖曳中、搜尋中與完成狀態。視覺設計使用 SiteSensory 自己的品牌語言，不複製 Pinterest 的圖示或外觀。

## 安全與資料邊界

- 所有主機服務只綁定 loopback。測試會從區域網路位址確認無法連線。
- Docker Compose 不向區域網路發布 PostgreSQL；只有必要的 web 與 API localhost 連接埠可使用。本機資產目錄不掛載到 web 可直接列出的靜態目錄。
- 網址擷取要防 SSRF（伺服器端請求偽造）。每次 DNS 解析與 redirect 都重新檢查目的位址，不能只檢查第一個網址。
- 瀏覽器擷取使用獨立、無登入資料的 context，不掛載開發人員瀏覽器設定、cookie 或主機秘密。
- 頁面內容、HTML、圖片與 Codex 輸出都視為不可信輸入，不得當成指令執行。
- Codex context 只包含分析需要的公開頁面證據。token、cookie、完整 request header 與內部檔案路徑不得送出。
- 本機登入使用安全的密碼雜湊與 `httpOnly`、`sameSite` cookie。即使只有一個帳號，所有私人查詢仍以 session 的 `user_id` 篩選。
- 金鑰、密碼與 token 只放在未進版控的環境設定。Repository 提供 `.env.example`，只列變數名稱與安全範例。
- 刪除收藏、私人標籤及人工覆核等操作留下稽核事件；log 不記錄密碼、session token 或完整 AI 圖片內容。
- 備份至少包含 PostgreSQL 與本機資產目錄，保存到另一個儲存裝置，並完成一次還原演練後才算有效。

## 測試與品質門檻

### 單元測試

- 網址正規化、追蹤參數處理、private IP 判斷及 redirect 重新驗證。
- 框選比例座標轉換、邊界與最小尺寸。
- 工作狀態合法轉換、租約到期及重試判斷。
- Codex JSON schema、分類允許值與未知標籤隔離。
- 搜尋重新排序、重複排除及最新版本限制。
- 圖片差異特徵與易變區域權重。

### 整合測試

- API 與 PostgreSQL 的 transaction、唯一限制與冪等請求。
- PostgreSQL 工作領取的並發安全；兩個 worker 不能取得同一租約。
- 本機 `ObjectStorage` 的資產寫入、讀取、hash 驗證、路徑限制與刪除保護。
- Capture worker 使用本機 fixture 網站擷取首屏與完整頁面。
- Embedding provider 產生固定維度並能以 pgvector 找回已知相似圖片。
- Codex CLI claim、context、submit、failure 的完整契約。
- 使用者 A 無法讀寫使用者 B 的收藏、原因或私人標籤。

### 端到端測試

- 新網址經 API、擷取、圖片向量、Codex 結果提交、品質檢查後出現在搜尋頁。
- 相同網址與相同 idempotency key 重送不建立重複網站、頁面或工作。
- 同頁面小幅內容變化標成 unchanged；明顯改版建立新版本並保留舊圖片。
- 依語言與頁面類型搜尋「關於我們」及「最新消息列表」，結果圖片與原始網址正確。
- 在頁面詳情框選區域後，相似結果更新；收藏後清單顯示相同視角。
- 同一頁面保存兩個不同視角，各自擁有標籤與收藏原因。
- 前台所有頁面都沒有輸入網址或建立收錄工作的入口。
- 區域網路無法連上 API，localhost 可以正常操作。

### 真實網站校正

至少準備 30 個可公開存取網址，涵蓋首頁、關於我們、產品或服務、最新消息列表、最新消息內容與聯絡頁，並包含至少三種語言。從中建立：

- 正規網址與 redirect 的預期結果。
- 設計未變、內容微調及明顯改版的成對截圖。
- 至少 50 組框選區域及人工判定的相似／不相似案例。
- 每個頁面類型與語言的人工標籤。

樣本集保存網址、擷取日期與使用目的，不把第三方圖片複製進公開 repository。驗收門檻要在樣本建立後寫入本文件，不用未經測量的數字代替。

## 開發任務

每項任務完成後只執行與該差異直接相關的測試、typecheck、lint 與整合驗證。完整測試、build、資料庫核對及 UI 流程矩陣留到 production code 凍結後由最終驗收一次執行。

### P0：確認架構與第一版預設

- 狀態：已完成（2026-09-17）。桌面擷取使用 `1920 × 1080`、device scale factor `1`；第一版使用單一本機帳號與 Codex CLI。
- 角色：架構師。
- 輸入：`doc/vision.md`、本計劃及使用者確認。
- 產出：確認技術架構、桌面擷取尺寸、單一本機帳號、Codex CLI 工作方式與樣本準備方式；把結論回寫本文件。
- 完成條件與驗證：所有待確認項目都有明確結論，文件狀態改為 `部分可執行`，沒有相互矛盾的第一版範圍。
- 證據：`doc/plan.md` 的施工就緒查核與 git diff。
- 依賴：無。
- 確認節點：完成後停下，等待使用者確認才進入實作。
- 回滾點：保留 `doc/vision.md`，撤回未確認的計劃變更。

### P1：建立專案骨架與本機環境

- 狀態：已完成（2026-09-17）。驗證摘要位於 `artifacts/verification/p1/summary.md`。
- 角色：工程師。
- 輸入：已確認的 P0。
- 產出：pnpm workspace、TypeScript 共用設定、`apps`／`packages`／`tools` 結構、Docker Compose、PostgreSQL、pgvector、本機資產目錄、環境設定驗證與基礎 CI 指令。
- 完成條件與驗證：全新 clone 能依 README 啟動；服務只綁 localhost；資料庫不對區域網路公開；lint、typecheck 與最小 smoke test（冒煙測試）通過。
- 證據：`artifacts/verification/p1/`。
- 依賴：P0。
- 確認節點：無。
- 回滾點：P0 確認後、尚無程式碼的狀態。

### P2：建立資料庫與共用契約

- 狀態：已完成（2026-09-17）。驗證摘要位於 `artifacts/verification/p2/summary.md`。
- 角色：工程師。
- 輸入：P1、本文件的資料模型與狀態表。
- 產出：migration、Kysely types（型別）、Zod schema、狀態轉換服務、seed taxonomy（初始公共分類）及資料庫整合測試。
- 完成條件與驗證：空資料庫可前進與回滾 migration；所有資料表都有 `created_at`；唯一限制、外鍵、交易與非法狀態轉換測試通過。
- 證據：`artifacts/verification/p2/`。
- 依賴：P1。
- 確認節點：資料表或狀態若需偏離本文件，先停下更新計劃並確認。
- 回滾點：P1 完成狀態。

### P3：實作 localhost API 與本機帳號

- 狀態：已完成（2026-09-17）。公開、私人與內部 API 邊界已建立；本機帳號、OpenAPI、Zod 契約及 PostgreSQL 私人資料隔離測試通過。驗證摘要位於 `artifacts/verification/p3/summary.md`。
- 角色：工程師。
- 輸入：P2 契約。
- 產出：Fastify API、統一錯誤格式、request ID、localhost 綁定、本機 session、收錄、工作、搜尋、收藏與標籤端點骨架。
- 完成條件與驗證：OpenAPI 與 Zod 契約一致；非 localhost 連線失敗；跨使用者私人資料測試通過；前台 API 不存在網址提交端點。
- 證據：`artifacts/verification/p3/`。
- 依賴：P2。
- 確認節點：無。
- 回滾點：P2 完成狀態。

### P4：實作網址安全、去重與工作佇列

- 狀態：已完成（2026-09-18）。網址正規化、DNS 與 redirect SSRF 防護、冪等收錄、PostgreSQL 原子領取、lease、過期回收與重試已完成。驗證摘要位於 `artifacts/verification/p4/summary.md`。
- 角色：工程師。
- 輸入：P3、網址正規化與工作狀態契約。
- 產出：網址正規化、SSRF 防護、redirect 驗證、冪等收錄、PostgreSQL 原子領取、lease、重試及 job attempt 紀錄。
- 完成條件與驗證：相同網址變體與 idempotency key 不重複；private／link-local／metadata 位址及 redirect 轉入受限位址都被拒絕；並發領取不重複。
- 證據：`artifacts/verification/p4/`。
- 依賴：P3。
- 確認節點：任何需要放寬網路限制的網站都先進人工檢查，不直接建立例外。
- 回滾點：P3 完成狀態。

### P5：實作頁面擷取、內頁探索與版本比較

- 狀態：已實作、待改版門檻校正（2026-09-18）。`desktop-1920` 首屏與完整頁面擷取、本機檔案儲存、DOM 摘要、內頁候選及 fixture 版本比較已通過；已從 DBCut 匯入 6 個真實公開網站樣本。驗證摘要位於 `artifacts/verification/p5/summary.md`。
- 角色：工程師。
- 輸入：P4、已確認的 viewport 設定、本機 fixture 網站。
- 產出：Playwright worker、首屏與完整截圖、本機 `ObjectStorage` 資產、DOM 摘要、內頁候選、圖片特徵、版本比較及人工覆核狀態。
- 完成條件與驗證：fixture 的成功、逾時、redirect、無限滾動、cookie banner（Cookie 提示）與擷取失敗案例可重複；小變化與明顯變化能走不同狀態，門檻仍標記待真實樣本校正。
- 證據：`artifacts/verification/p5/`。
- 依賴：P4。
- 確認節點：建立正式改版判斷門檻前，需要更多真實網站的重複擷取與人工判讀結果。
- 回滾點：P4 完成狀態；刪除本階段可重建的測試資產。

### P6：建立圖片向量介面與相似搜尋

- 角色：工程師。
- 輸入：P2、P5、框選樣本規格。
- 產出：embedding provider interface、模型登錄、區域向量、pgvector exact search、條件過濾、重新排序與搜尋理由。
- 完成條件與驗證：更換模型不需要修改頁面、收藏或搜尋 API；固定圖片能找回已知候選；結果排除目前頁面、舊版本與重複項目。
- 證據：`artifacts/verification/p6/`。
- 依賴：P2、P5。可與 P7 的 CLI 基礎部分並行。
- 確認節點：選定第一個圖片模型及建立 HNSW 前，提交真實框選樣本比較結果供確認。
- 回滾點：保留 provider interface 與 exact search，移除未通過評估的模型資料及索引。

### P7：建立 Codex CLI 與分析契約

- 狀態：部分完成（2026-09-18）。版本化分析 schema、內部分析提交 API、公共分類寫入、未知標籤隔離與相同結果冪等提交已完成；Codex 已分析 6 個網站的 33 張頁面。工作 claim、context、failure 與 lease 流程仍未實作，因此 P7 尚未完成。驗證摘要位於 `artifacts/verification/p7/summary.md`。
- 角色：工程師。
- 輸入：P2、P3、Codex 輸出欄位。
- 產出：CLI 命令、analysis claim／context／submit／failure API、版本化 JSON schema、提示與分類規則檔、未知標籤隔離及完整稽核資料。
- 完成條件與驗證：Codex 不需要資料庫憑證即可完成一筆工作；錯誤 schema、過期 lease、錯誤頁面版本及未知公共標籤都被拒絕或隔離；重送相同結果不重複建立分析。
- 證據：`artifacts/verification/p7/`。
- 依賴：P3；可與 P6 部分並行。
- 確認節點：使用真實 Codex 任務分析第一批公開網站前，確認資料處理設定。
- 回滾點：P3 API；撤回未確認的提示版本與分析結果。

### P8：完成發布、搜尋與頁面詳情

- 角色：工程師。
- 輸入：P5、P6、P7。
- 產出：品質檢查、發布 transaction、混合搜尋、篩選、cursor 分頁、頁面詳情、原始連結與相似推薦 API。
- 完成條件與驗證：缺少圖片、主要頁面類型或有效分析的版本不能發布；搜尋只回最新公開版本；語言與頁面類型篩選正確；來源網址與圖片屬於同一版本。
- 證據：`artifacts/verification/p8/`。
- 依賴：P5、P6、P7。
- 確認節點：無。
- 回滾點：保留草稿資料，撤回發布與搜尋接線。

### P9：完成搜尋、詳情與框選介面

- 狀態：薄切片已完成（2026-09-18）。已可登入本機前端、查詢已發布頁面、以語言與頁面類型篩選、查看首屏與完整頁面圖片、開啟原始網址並拖曳框選。詳情已能顯示同站截圖與相似候選；目前候選以頁面類型、語言及分析摘要排序，圖片向量相似度仍待 P6 完成後替換評分來源。
- 角色：前端工程師。
- 輸入：P8 API、前端畫面與框選契約。
- 產出：首頁、搜尋頁、頁面詳情、篩選、外部連結、框選工具與相似結果；包含載入、錯誤、空資料及過期請求取消。
- 完成條件與驗證：在真實瀏覽器以桌面與窄螢幕尺寸渲染；鍵盤與指標操作可完成框選；console 無未處理錯誤；每個相似結果顯示相符圖片區域與原始連結。
- 證據：`artifacts/verification/p9/` 的截圖、console 與 Playwright 測試結果。
- 依賴：P8。
- 確認節點：先確認線框與設計 token，再完成視覺細節。
- 回滾點：保留 API，撤回未通過互動驗證的前端變更。

### P10：完成收藏、私人標籤與收藏原因

- 狀態：薄切片已完成（2026-09-18）。已可建立私人標籤、在收藏時寫下原因並保存框選座標；標籤版圖與多使用者完整前端驗證仍待後續補齊。
- 角色：前端工程師。
- 輸入：P3 私人資料 API、P9 框選工具。
- 產出：收藏視角、收藏清單、私人標籤管理、標籤版圖、收藏原因及多視角流程。
- 完成條件與驗證：相同頁面可保存兩個不同視角；標籤刪除不刪收藏；重新登入後仍顯示相同區域與原因；另一使用者無法存取。
- 證據：`artifacts/verification/p10/`。
- 依賴：P3、P9。
- 確認節點：無。
- 回滾點：P9 完成狀態；保留既有頁面與分析資料。

### P11：建立內部工作檢查頁與真實樣本

- 角色：工程師與前端工程師。
- 輸入：P5、P7、P8，以及使用者提供或確認的公開網址。
- 產出：工作狀態頁、待人工檢查清單、版本差異檢視、AI 原始結果與修正入口、真實校正樣本。
- 完成條件與驗證：失敗工作可看出階段與可採取動作；人工修正不覆蓋原始分析；樣本涵蓋計劃要求的頁面類型與語言。
- 證據：`artifacts/verification/p11/` 與不含第三方圖片的樣本清單。
- 依賴：P5、P7、P8。
- 確認節點：樣本清單及人工覆核規則由使用者確認。
- 回滾點：保留工作與證據，撤回未確認的分類修正。

### P12：階段審查與問題收斂

- 角色：審查員。
- 輸入：P1 至 P11 的實作、測試與文件。
- 產出：依嚴重度排序的問題清單，檢查重複實作、責任邊界、錯誤處理、狀態與端點是否有實際呼叫者，以及文件同步狀態。
- 完成條件與驗證：逐一反查每個狀態轉換、API、事件、權限與 UI 動作都有 producer、consumer 及測試；阻擋與高風險問題都有處理結論。
- 證據：`artifacts/verification/p12/review.md`。
- 依賴：P1 至 P11 對應功能完成。各施工批次先做局部 diff 審查，P12 做凍結前的整體審查。
- 確認節點：高風險或需要改變架構的問題先交使用者確認。
- 回滾點：回到產生問題的最近任務完成狀態。

### P13：效能校正

- 角色：優化師。
- 輸入：P12 問題、真實樣本與量測基線。
- 產出：擷取時間、圖片處理時間、搜尋延遲、向量 recall、資料庫查詢與前端渲染的基線及必要改善。
- 完成條件與驗證：優化前後使用同一批資料及同一套指令；功能結果不變；效能改善有數據，無法量測的判斷明確標為推測。
- 證據：`artifacts/verification/p13/`。
- 依賴：P11、P12。
- 確認節點：若需要改變 API、資料模型或產品行為，退回架構確認，不以效能名義直接改契約。
- 回滾點：P12 通過的功能版本。

### P14：凍結候選版本與四項最終驗收

- 角色：審查員、安全審查員與驗收員，依固定順序執行。
- 輸入：P13 完成版本、`doc/vision.md`、本計劃及所有階段證據。
- 產出：凍結 commit、完整 QA 矩陣、`Ai Slop Cleaner → Code Review → Security Review → UltraQA` 四項結果，以及 `doc/acceptance.md`。
- 完成條件與驗證：
  - Ai Slop Cleaner 移除樣板、殘留與不一致實作，相關回歸測試通過。
  - Code Review 沒有未處理的阻擋或高風險問題，且程式碼、API、資料表與文件一致。
  - Security Review 覆蓋 SSRF、輸入驗證、session、私人資料隔離、秘密、容器連接埠、Codex 資料邊界與依賴漏洞。
  - UltraQA 統一執行完整 test、typecheck、lint、build、migration、備份還原、端到端流程、桌面與窄螢幕 UI、區域網路阻擋及真實樣本矩陣。
  - 驗收報告逐條對照 `doc/vision.md`，分成已達成、未達成與範圍外。
- 證據：`artifacts/verification/final/` 與 `doc/acceptance.md`。
- 依賴：P13。
- 確認節點：凍結 production code 前確認候選版本。四項都沒有已知阻擋問題後，才可宣告第一版完成。
- 回滾點：P13 完成版本。Code Review、Security Review 或 UltraQA 的修正若改到 production code，解除凍結並從 Ai Slop Cleaner 重新開始；只改測試、文件或證據時只重跑受影響驗證。

## 文件同步規則

實作若改變產品範圍、資料模型、狀態、API、權限、搜尋預設值、AI schema、公共分類或 UI 行為，必須同步更新 `doc/vision.md` 與 `doc/plan.md`。只改內部實作方式時至少更新本計劃的任務狀態或證據位置。文件與程式碼不一致時，該任務不得標成完成。

## 第一版完成定義

第一版完成必須同時符合以下條件：

- 開發電腦能從零啟動完整系統，服務沒有暴露到區域網路或公開網路。
- 內部 CLI 能提交網址，工作能安全重試且不產生重複頁面。
- Playwright 能保存頁面圖片與版本證據，明顯改版能建立新版本。
- Codex 能透過 CLI 完成結構化分析，API 能拒絕不合法結果。
- 使用者能依語言、頁面類型與視覺特徵搜尋，每個結果都有正確圖片與原始連結。
- 框選區域能驅動相似搜尋，收藏後能保存相同視角、私人標籤與原因。
- 所有正式資料都有 `created_at`，AI、擷取與發布時間各自保存。
- 備份與還原經過實際驗證。
- 四項最終驗收對應同一個凍結版本，沒有未處理的阻擋問題。
