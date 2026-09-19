export const PAGE_TYPE_SEEDS = [
    { key: 'home', name: '首頁' },
    { key: 'about', name: '關於我們' },
    { key: 'product-service', name: '產品或服務' },
    { key: 'case-study', name: '案例' },
    { key: 'pricing', name: '價格' },
    { key: 'news-list', name: '最新消息列表' },
    { key: 'news-detail', name: '最新消息內容' },
    { key: 'blog-list', name: '部落格列表' },
    { key: 'blog-detail', name: '部落格內容' },
    { key: 'faq', name: '常見問題' },
    { key: 'careers', name: '人才招募' },
    { key: 'contact', name: '聯絡我們' },
    { key: 'other', name: '其他' },
] as const

export const PAGE_TYPE_KEYS = PAGE_TYPE_SEEDS.map(seed => seed.key) as [
    typeof PAGE_TYPE_SEEDS[number]['key'],
    ...Array<typeof PAGE_TYPE_SEEDS[number]['key']>,
]

export type PageTypeKey = typeof PAGE_TYPE_SEEDS[number]['key']

export const TAXONOMY_TERM_SEEDS = [
    { groupKey: 'industry', key: 'technology', name: '科技' },
    { groupKey: 'industry', key: 'ecommerce', name: '電子商務' },
    { groupKey: 'industry', key: 'education', name: '教育' },
    { groupKey: 'industry', key: 'travel', name: '旅遊' },
    { groupKey: 'industry', key: 'hospitality', name: '餐旅' },
    { groupKey: 'industry', key: 'finance', name: '金融' },
    { groupKey: 'industry', key: 'health', name: '健康醫療' },
    { groupKey: 'industry', key: 'nonprofit', name: '非營利組織' },
    { groupKey: 'industry', key: 'creative-agency', name: '創意服務' },
    { groupKey: 'style', key: 'minimal', name: '極簡' },
    { groupKey: 'style', key: 'editorial', name: '編輯式' },
    { groupKey: 'style', key: 'corporate', name: '企業' },
    { groupKey: 'style', key: 'playful', name: '活潑' },
    { groupKey: 'style', key: 'luxury', name: '精品' },
    { groupKey: 'style', key: 'brutalist', name: '粗獷主義' },
    { groupKey: 'style', key: 'illustration-led', name: '插畫主導' },
    { groupKey: 'style', key: 'photography-led', name: '攝影主導' },
    { groupKey: 'layout', key: 'single-column', name: '單欄' },
    { groupKey: 'layout', key: 'split-screen', name: '分割畫面' },
    { groupKey: 'layout', key: 'card-grid', name: '卡片網格' },
    { groupKey: 'layout', key: 'masonry', name: '瀑布流' },
    { groupKey: 'layout', key: 'full-bleed', name: '滿版' },
    { groupKey: 'layout', key: 'sidebar', name: '側欄' },
    { groupKey: 'motion', key: 'static', name: '靜態' },
    { groupKey: 'motion', key: 'light', name: '輕度動態' },
    { groupKey: 'motion', key: 'moderate', name: '中度動態' },
    { groupKey: 'motion', key: 'high', name: '高度動態' },
] as const
