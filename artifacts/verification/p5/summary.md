# P5 階段驗證摘要

日期：2026-09-18

## 已完成

- Playwright 使用 `desktop-1920`：viewport `1920 × 1080`、device scale factor `1`、UTC 時區與固定語系。
- 同一次擷取保存首屏與完整頁面 PNG，等待 network idle 與字型，並停用動畫及 transition。
- 保存頁面標題、語言、可見文字摘要、最終網址與同站內頁候選。
- 排除外站、登入、登出、搜尋、購物車、結帳、session 及 token 連結。
- 本機 `ObjectStorage` 只接受程式產生的 object key，拒絕路徑穿越；資料庫可只保存 object key、hash 與檔案大小。
- 建立 fixture 專用的灰階圖片差異計算，可區分完全相同與明顯不同的頁面。
- 內部 API 已能接收擷取結果，寫入 `sites`、`pages`、`page_versions` 與 `assets`。
- 從 DBCut 最新清單解析外部網站連結，除首頁外也依關於、服務、案例、消息、聯絡等優先順序擷取同站內頁；單站上限可由 `PAGES_PER_SITE` 調整。
- `apps/web` 已有可操作的本機前端，可搜尋、篩選、查看截圖、開原站、框選視角、建立私人標籤並儲存收藏原因。
- 前端瀑布流已調整為以圖片為主的瀏覽方式：預設顯示全部已收錄頁面，卡片加寬並提供「查看詳情」與快速儲存，列表不顯示網站標題；完整 `1920px` 圖片、網站資料、同站截圖與相似候選集中在詳情視圖，右側抽屜負責框選收藏。
- 搜尋、語言、內頁類型與私人標籤已改為左側浮動抽屜；預設畫面只保留小型工具列，主清單不再被固定側欄壓縮。
- 前端互動元件已統一改用 Keel：按鈕、表單、卡片、提示、載入狀態與左右抽屜由 `@keel-design/ui` 提供，圖示由 `@keel-design/icons` 提供，視覺 token(設計變數)、主題與 Tailwind preset(預設樣式)由 Keel 套件載入。

## 驗證

- 使用本機 HTTP fixture 與真實 Chromium 執行 5 項測試，全部通過。
- 首屏圖片實際尺寸為 `1920 × 1080`。
- 完整頁面圖片實際寬度為 `1920`，高度超過 fixture 的 2000px 內容。
- 重複擷取判定為 `unchanged`，大幅改色 fixture 判定為 `new_version`。
- 路徑穿越、外站連結與危險流程連結均被拒絕或排除。
- DBCut 匯入結果保存於 `artifacts/verification/p5/dbcut-import.json`；首頁擷取成功後會接續匯入可用內頁，單一內頁逾時不會中止整站。
- API 查詢 `GET /api/v1/pages` 回傳 25 筆唯一的已發布頁面，分布於 8 個網域；同一頁面的多次成功分析只採用最新一筆，不會讓清單重複。
- 已驗證頁面語言包含 `en`、`en-US`、`ja`、`ko`、`ko-KR`；內頁類型包含關於、案例、聯絡、常見問題、消息列表、消息內容與部落格列表。
- 前端以 Playwright 實際操作：登入、讀取 6 張卡片、搜尋 `Khanh` 後剩 1 張、點選詳情、拖曳框選、建立私人標籤、儲存收藏視角與收藏原因。
- 前端操作截圖保存於 `artifacts/verification/p5/web-smoke.png`；操作後未發現破圖，瀏覽器 console 沒有錯誤訊息。
- Pinterest 參考版介面操作截圖保存於 `artifacts/verification/p5/web-pinterest-reference-smoke.png`；實測 6 張首頁卡片、第一張卡片來源圖為 `1920 × 22819`，卡片預覽高度限制為 520px，未發現破圖或 console 錯誤。
- 依規劃書補正前端互動：點選圖片會進入頁面詳情，詳情顯示該網站所有相關截圖與相似候選；點選「儲存」才開啟右側浮動抽屜。左側搜尋分類與右側收藏都以浮動抽屜呈現，不會壓縮首頁圖片清單。
- 以 1280px 寬瀏覽器實際驗證為四欄瀑布流，單卡約 272px；寬螢幕最高六欄。清單不顯示標題，滑入後才出現「查看詳情」與「儲存」。
- 相似候選 API 已可回傳結果，第一版以頁面類型、語言與分析摘要排序。這只能驗證完整互動與 API 契約，不能取代 P6 的圖片向量相似度校正。
- 浮動收藏抽屜驗證截圖保存於 `artifacts/verification/p5/web-floating-save-drawer.png`；實測首頁 6 張、`medi.soijeong.com` 同站集合 1 張、圖片無破圖、console 無錯誤。
- 左側浮動搜尋抽屜驗證截圖保存於 `artifacts/verification/p5/web-floating-filter-drawer.png`；右側收藏抽屜與左側工具列共存驗證截圖保存於 `artifacts/verification/p5/web-floating-search-rail.png`。實測預設搜尋抽屜不顯示、點選工具列可打開、搜尋 `med` 後剩 1 張、關閉後可繼續開啟收藏抽屜，console 無錯誤。
- Keel 版本以 1280 × 900 瀏覽器實際操作登入、首頁、搜尋抽屜、詳情與收藏抽屜；首頁顯示 25 張唯一頁面卡片，1280px 寬度呈現四欄且首張卡片約 275px，抽屜內的裁切預覽為 470 × 360，未發現 `console.error` 或 page error(頁面錯誤)。驗證畫面保存於 `artifacts/verification/p5/web-keel-home.png`、`artifacts/verification/p5/web-keel-filter-drawer.png` 與 `artifacts/verification/p5/web-keel-save-drawer.png`。
- 列表分頁固定為每頁 18 筆。實測第一頁只載入 18 張，向下捲動後載入至 25 張並把網址更新為 `?page=2`；直接開啟第二頁網址可重建 25 張已載入卡片。
- 公開列表圖片由 `/thumbnails/*` 自動轉成 640px WebP；私人收藏版圖由 `/api/v1/saved-views/:id/preview` 依儲存座標裁切後轉成 640px WebP。實測 6 筆既有收藏預覽皆成功載入，沒有破圖。
- 收藏抽屜預設使用整頁座標 `x=0`、`y=0`、`width=1`、`height=1`，畫面不顯示選框。點擊圖片後才建立局部選框，選框支援移動與右下角縮放；「改用整頁」會移除選框。端到端驗收建立一筆整頁收藏、讀取其 WebP 預覽後刪除測試資料，資料庫未留下驗收紀錄。
- 分頁首頁、整頁收藏、局部選框與私人收藏版圖的 1280 × 900 驗證畫面保存於 `artifacts/verification/p5/web-pagination-page-1.png`、`artifacts/verification/p5/web-save-full-page.png`、`artifacts/verification/p5/web-save-local-selection.png` 與 `artifacts/verification/p5/web-saved-board.png`。
- 最終驗證執行 `pnpm lint`、`pnpm typecheck` 與單一 worker 的完整 Vitest 測試；8 個測試檔通過、1 個資料庫整合測試檔因未設定 `TEST_DATABASE_URL` 跳過，共 33 項通過、1 項跳過。

## 待確認

目前圖片差異規則版本仍為 `fixture-v1-uncalibrated`，只能證明流程可執行，不能代表真實網站上的改版判斷準確。真實網站已可收錄與展示，但改版門檻、圖片向量相似搜尋與 Codex 分析品質仍需後續樣本校正。
