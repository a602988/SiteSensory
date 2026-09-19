# Web

SiteSensory 的本機前端工作台。

介面元件統一使用 Keel：互動元件來自 `@keel-design/ui`，圖示來自
`@keel-design/icons`，色彩、字體與間距則由 `@keel-design/tokens`、
`@keel-design/themes` 與 `@keel-design/tailwind-config` 提供。專案透過
Tailwind CSS v4 的 Vite 外掛載入 Keel 樣式。

目前第一版提供：

- 以關鍵字、語言與頁面類型篩選已收錄頁面。
- 預設顯示全部已收錄頁面；需要時可只查看首頁或其他內頁類型。
- 搜尋、語言、內頁類型與私人標籤集中在左側浮動抽屜，預設只顯示小型工具列，不佔用主清單寬度。
- 以接近 Pinterest 尺寸的圖片瀑布流瀏覽網站截圖；滑過圖片可看見「查看詳情」與「儲存」，網站標題、語言、頁面類型與原始網址只在詳情顯示。列表使用伺服器自動產生的 640px WebP 縮圖，不下載 1920px 原圖。
- 詳情保留原始 `1920px` 寬度圖片，並列出同站截圖與依公共分類、語言及分析摘要排序的相似設計。
- 可在卡片上快速儲存完整頁面視角。
- 收藏預設保存整個頁面。點選完整頁面圖片後才會出現局部選框；選框可以拖曳移動，也可以從右下角調整大小。
- 建立私人標籤，並在收藏視角時寫下收藏原因。
- 私人收藏版圖只顯示實際保存的視角，由伺服器先裁切原圖再產生 640px WebP 預覽。
- 公開頁面與私人收藏版圖每次載入 18 筆。向下捲動會載入下一頁，網址以 `?page=2` 保存目前進度；直接開啟該網址會重建前面已載入的頁面。
- 本機登入畫面預填開發密碼；公開部署前必須移除預填並重新設計登入流程。

啟動方式：

```sh
pnpm install
pnpm web:dev
```

開發伺服器會把 `/api`、`/assets` 與 `/thumbnails` 代理到 `http://127.0.0.1:4100`，因此需要先啟動 API。

## 本機 Keel 套件

目前內部開發環境尚未設定 GitHub Packages 憑證，`apps/web/package.json` 會直接連結同層
`keel-design` repository(程式碼儲存庫)的套件。兩個 repository 預期放在同一個父目錄：

```text
GitHub/
├── SiteSensory/
└── keel-design/
```

首次安裝或 Keel 原始碼更新後，先在 `keel-design` 建置前端會使用的套件：

```sh
pnpm --dir ../keel-design --filter @keel-design/tokens build
pnpm --dir ../keel-design --filter @keel-design/icons build
pnpm --dir ../keel-design --filter @keel-design/utils build
pnpm --dir ../keel-design --filter @keel-design/ui build
```

正式部署改用 GitHub Packages 時，只需把 `link:` 依賴換成已發布版本；應用程式仍使用相同的
Keel package(套件)公開 API。
