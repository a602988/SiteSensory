# P7 分析提交薄切片驗證摘要

日期：2026-09-18

## 實作範圍

- 新增 `POST /internal/v1/pages/:pageId/analysis`，只接受內部 API 金鑰。
- 請求內容使用版本化 `analysisResultSchema` 驗證。
- 同一個 transaction(交易)保存分析紀錄、摘要、主要語言、頁面類型、公共搜尋標籤與待審標籤。
- 重新分析會替換同一頁面版本的舊 AI 語言與標籤。相同分析結果重送時不會新增分析紀錄。
- 未列入公共分類的詞只寫入 `pending_taxonomy_terms`，不會直接出現在搜尋標籤。

## 真實網站批次

依 `doc/capture-rules.md` 重新掃描 DBCut 最新網站，取得 6 個有效網站、33 張成功頁面：

- `brand.trinityairways.com`
- `artpieent.com`
- `squiz.co.jp`
- `khanhnguyen.design`
- `www.mathflat.com`
- `esg.skdiscovery.com`

Trinity 有 1 張內頁會改變程式指定的捲動位置，可能造成合成缺口，因此拒絕發布。`hobro.digital` 回傳存取驗證頁，也拒絕發布並由批次流程補抓下一個網站。完整匯入結果保存在 `artifacts/verification/p5/dbcut-import.json`。

Codex 依截圖、標題、網址、語言與文字摘要分析全部 33 張成功頁面。每張頁面都有主要語言、頁面類型、分析摘要、設計品質分數，以及產業、風格、版型與動態程度的公共搜尋標籤。

## 驗證結果

- 分析提交 API：33 筆成功，0 筆失敗。
- API 操作矩陣：41 項通過，涵蓋健康狀態、33 筆詳情、語言篩選、頁型篩選、標籤篩選、網域篩選、相似搜尋、原圖與縮圖。
- 資料庫核對：33 筆目前版本皆有 1920px 原圖、最新 Codex 分析、非空摘要與至少一個公共標籤。
- 冪等驗證：相同 33 筆結果重送後，`codex-cli` 成功分析紀錄仍為 33 筆。
- 前端操作：ARTPIE 詳情顯示「創意服務、滿版、中度動態、編輯式、攝影主導」；點擊標籤後網址為 `?page=1&tag=creative-agency`，列表正常顯示搜尋結果。
- 相關測試：`tests/api/routes.test.ts` 與 `tests/capture/capture.test.ts` 共 17 項通過。

## 尚未完成

P7 原規劃中的分析工作 claim、context、failure 與 lease 流程尚未實作。圖片向量相似搜尋屬於 P6，目前相似排序仍以頁型、語言、摘要與版面比例為主。
