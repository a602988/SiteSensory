import {
    ArrowLeft,
    ArrowsMaximize,
    Bell,
    ChevronDown,
    ExternalLink,
    Filter,
    Home,
    Info,
    Link,
    List,
    Plus,
    Search,
    Sparkles,
    X,
} from '@keel-design/icons'
import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Drawer,
    DrawerBody,
    DrawerCloseButton,
    DrawerContent,
    DrawerDescription,
    DrawerHeader,
    DrawerTitle,
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Dropdown,
    DropdownContent,
    DropdownItem,
    DropdownRadioGroup,
    DropdownRadioItem,
    DropdownSeparator,
    DropdownTrigger,
    InlineMessage,
    Input,
    Label,
    Spinner,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@keel-design/ui'
import {
    useEffect,
    useRef,
    useState,
} from 'react'

import { PAGE_TYPE_SEEDS } from '@sitesensory/contracts'
import type {
    PageDetail,
    PageList,
    PageSummary,
    SavedView,
    SavedViewList,
    SimilarPage,
    UserTag,
} from '@sitesensory/contracts'

type Selection = {
    height: number
    width: number
    x: number
    y: number
}

type ResizeHandle = 'nw' | 'se'

type DragState = {
    handle?: ResizeHandle
    initial: Selection | null
    mode: 'create' | 'move' | 'resize'
    moved: boolean
    startX: number
    startY: number
}

type ViewMode = 'browse' | 'saved'
type DrawerMode = 'board' | 'notifications' | 'search' | 'upload'
type HistoryAction = 'none' | 'push' | 'replace'

type Presence<T> = {
    closing: boolean
    value: T | null
}

export function App()
{
    const initialPage = useRef(readPageNumber())
    const initialDetailId = useRef(readDetailPageId())
    const [pages, setPages] = useState<PageSummary[]>([])
    const [page, setPage] = useState(1)
    const [pageTotal, setPageTotal] = useState(0)
    const [hasMore, setHasMore] = useState(false)
    const [viewDetail, setViewDetail] = useState<PageDetail | null>(null)
    const [detail, setDetail] = useState<PageDetail | null>(null)
    const [similarPages, setSimilarPages] = useState<SimilarPage[]>([])
    const [query, setQuery] = useState('')
    const [language, setLanguage] = useState('')
    const [pageType, setPageType] = useState('')
    const [searchTag, setSearchTag] = useState(readSearchTag)
    const [tags, setTags] = useState<UserTag[]>([])
    const [savedViews, setSavedViews] = useState<SavedView[]>([])
    const [savedPage, setSavedPage] = useState(1)
    const [savedTotal, setSavedTotal] = useState(0)
    const [savedHasMore, setSavedHasMore] = useState(false)
    const [reason, setReason] = useState('')
    const [sitePages, setSitePages] = useState<PageSummary[]>([])
    const [newTag, setNewTag] = useState('')
    const [selectedBoardId, setSelectedBoardId] = useState('')
    const [boardQuery, setBoardQuery] = useState('')
    const [uploadFile, setUploadFile] = useState<File | null>(null)
    const [uploadName, setUploadName] = useState('')
    const [uploadUrl, setUploadUrl] = useState('')
    const [uploadError, setUploadError] = useState<string | null>(null)
    const [uploading, setUploading] = useState(false)
    const [password, setPassword] = useState('24241872')
    const [authenticated, setAuthenticated] = useState(false)
    const [drawerMode, setDrawerMode] = useState<DrawerMode | null>(null)
    const [viewMode, setViewMode] = useState<ViewMode>(readViewMode)
    const [selection, setSelection] = useState<Selection | null>(null)
    const [drag, setDrag] = useState<DragState | null>(null)
    const [loading, setLoading] = useState(true)
    const [lightbox, setLightbox] = useState<PageDetail | null>(null)
    const [lightboxActualSize, setLightboxActualSize] = useState(false)
    const [similarLoading, setSimilarLoading] = useState(false)
    const [innerPagesFirst, setInnerPagesFirst] = useState(false)
    const [scrollReady, setScrollReady] = useState(false)
    const [message, setMessage] = useState<string | null>(null)
    const imageRef = useRef<HTMLImageElement>(null)
    const uploadInputRef = useRef<HTMLInputElement>(null)
    const galleryGridRef = useRef<HTMLDivElement>(null)
    const relatedGridRef = useRef<HTMLDivElement>(null)
    const pageSentinelRef = useRef<HTMLDivElement>(null)
    const savedSentinelRef = useRef<HTMLDivElement>(null)
    const pageRequest = useRef(0)
    const sessionRequest = useRef(false)
    const detailRequest = useRef(0)
    const firstPageLoad = useRef(true)
    const browseScroll = useRef(0)
    const scrollRestorePending = useRef(false)
    const pagePresence = usePresence(viewDetail, 320)
    const savePresence = usePresence(detail, 320)
    const visiblePage = pagePresence.value
    const visibleSave = savePresence.value
    const displayedPages = pages
    const visiblePageId = visiblePage?.id
    const selectedBoard = tags.find(tag => tag.id === selectedBoardId) ?? null
    const relatedPages = uniqueById(innerPagesFirst
        ? [...sitePages, ...similarPages]
        : [...similarPages, ...sitePages])
    const currentSavedView = visiblePage
        ? savedViews.find(item => item.pageId === visiblePage.id)
        : null
    const currentBoard = currentSavedView
        ? tags.find(tag => currentSavedView.tagIds.includes(tag.id)) ?? null
        : null

    const [languages, setLanguages] = useState<string[]>([])

    useEffect(() => {
        const disconnect = observeMasonryGrid(galleryGridRef.current, '.gallery-card, .saved-view-card')
        const restoreFrame = !visiblePageId && scrollRestorePending.current
            ? window.requestAnimationFrame(() => {
                setDocumentScroll(browseScroll.current)
                scrollRestorePending.current = false
            })
            : null

        return () => {
            disconnect()

            if (restoreFrame !== null) window.cancelAnimationFrame(restoreFrame)
        }
    }, [displayedPages.length, savedViews.length, viewMode, visiblePageId])

    useEffect(() => {
        return observeMasonryGrid(relatedGridRef.current, '.image-button')
    }, [innerPagesFirst, relatedPages.length, visiblePageId])

    useEffect(() => {
        if (sessionRequest.current) return

        sessionRequest.current = true
        void login()
    }, [])

    useEffect(() => {
        if (visiblePageId) setDocumentScroll(0)
    }, [visiblePageId])

    useEffect(() => {
        if (!visiblePage) return

        const region = selection ?? FULL_PAGE_SELECTION
        const timer = window.setTimeout(() => {
            void loadSimilarPages(visiblePage.pageVersionId, region)
        }, selection ? 220 : 0)

        return () => window.clearTimeout(timer)
    }, [selection, visiblePageId])

    useEffect(() => {
        if (!lightbox) return

        const previousOverflow = document.body.style.overflow
        const closeWithEscape = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') closeLightbox()
        }

        document.body.style.overflow = 'hidden'
        window.addEventListener('keydown', closeWithEscape)

        return () => {
            document.body.style.overflow = previousOverflow
            window.removeEventListener('keydown', closeWithEscape)
        }
    }, [lightbox])

    useEffect(() => {
        if (!authenticated) return

        const targetPage = firstPageLoad.current ? initialPage.current : 1
        firstPageLoad.current = false

        void loadPageRange(targetPage)
    }, [authenticated, language, pageType, query, searchTag])

    useEffect(() => {
        if (!authenticated || !initialDetailId.current) return

        const pageId = initialDetailId.current

        initialDetailId.current = ''
        void openPageById(pageId, 'none')
    }, [authenticated])

    useEffect(() => {
        const syncDetailWithLocation = (): void => {
            const pageId = readDetailPageId()

            if (!pageId) {
                closePage(false, 'none')
                return
            }

            if (pageId !== visiblePageId) void openPageById(pageId, 'none')
        }

        window.addEventListener('popstate', syncDetailWithLocation)

        return () => window.removeEventListener('popstate', syncDetailWithLocation)
    }, [visiblePageId])

    useEffect(() => {
        if (!authenticated) return

        const sentinel = viewMode === 'browse' ? pageSentinelRef.current : savedSentinelRef.current

        if (!sentinel) return

        const observer = new IntersectionObserver(entries => {
            if (!entries[0]?.isIntersecting) return

            const pageCannotScroll = document.documentElement.scrollHeight <= window.innerHeight + 1

            if (!scrollReady && !pageCannotScroll) return

            if (viewMode === 'browse' && hasMore && !loading) void loadNextPage()
            if (viewMode === 'saved' && savedHasMore && !loading) void loadNextSavedPage()
        }, { rootMargin: '100px 0px' })

        observer.observe(sentinel)

        return () => observer.disconnect()
    }, [authenticated, hasMore, loading, page, savedHasMore, savedPage, scrollReady, viewMode])

    useEffect(() => {
        const unlock = (): void => setScrollReady(true)
        const unlockWithKey = (event: KeyboardEvent): void => {
            if (['ArrowDown', 'End', 'PageDown', ' '].includes(event.key)) unlock()
        }

        window.addEventListener('wheel', unlock, { passive: true })
        window.addEventListener('touchmove', unlock, { passive: true })
        window.addEventListener('keydown', unlockWithKey)

        return () => {
            window.removeEventListener('wheel', unlock)
            window.removeEventListener('touchmove', unlock)
            window.removeEventListener('keydown', unlockWithKey)
        }
    }, [])

    async function login()
    {
        const response = await fetch('/api/v1/session', {
            body: JSON.stringify({ password }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        })

        if (!response.ok) {
            setMessage('目前無法開啟內部資料庫，請確認 API 已啟動。')
            return
        }

        setAuthenticated(true)
        setPassword('')
        setMessage(null)

        await Promise.all([
            loadTags(),
            loadSavedViews(1, false),
        ])
    }

    async function loadPageRange(targetPage: number)
    {
        const requestId = pageRequest.current + 1
        pageRequest.current = requestId
        setLoading(true)

        try {
            const batches: PageSummary[] = []
            let finalPage: PageList | null = null

            for (let currentPage = 1; currentPage <= targetPage; currentPage += 1) {
                const response = await fetch(`/api/v1/pages?${buildPageParams(currentPage).toString()}`)

                if (!response.ok) throw new Error('頁面列表載入失敗')

                finalPage = await response.json() as PageList
                batches.push(...finalPage.items)

                if (!finalPage.hasMore) break
            }

            if (pageRequest.current !== requestId || !finalPage) return

            setPages(uniqueById(batches))
            setLanguages(current => mergeLanguages(current, batches))
            setPage(finalPage.page)
            setPageTotal(finalPage.total)
            setHasMore(finalPage.hasMore)
            updateLocation('browse', finalPage.page)
        }
        finally {
            if (pageRequest.current === requestId) setLoading(false)
        }
    }

    async function loadNextPage()
    {
        const nextPage = page + 1
        setLoading(true)

        try {
            const response = await fetch(`/api/v1/pages?${buildPageParams(nextPage).toString()}`)

            if (!response.ok) throw new Error('下一頁載入失敗')

            const body = await response.json() as PageList

            setPages(current => uniqueById([...current, ...body.items]))
            setLanguages(current => mergeLanguages(current, body.items))
            setPage(body.page)
            setPageTotal(body.total)
            setHasMore(body.hasMore)
            updateLocation('browse', body.page)
        }
        finally {
            setLoading(false)
        }
    }

    function buildPageParams(targetPage: number): URLSearchParams
    {
        const params = new URLSearchParams({ page: String(targetPage) })

        if (query) params.set('query', query)
        if (language) params.set('language', language)
        if (pageType) params.set('pageType', pageType)
        if (searchTag) params.set('tag', searchTag)

        return params
    }

    function updateLocation(mode: ViewMode, targetPage: number)
    {
        const params = mode === 'browse'
            ? buildPageParams(targetPage)
            : new URLSearchParams({ page: String(targetPage), view: 'saved' })
        const detailId = readDetailPageId()

        if (detailId) params.set('detail', detailId)

        window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
    }

    /**
     * 載入指定圖片的三欄詳細畫面，並在使用者點選時建立可分享的瀏覽紀錄。
     *
     * @param page 要顯示的公開頁面。
     * @param historyAction 詳情網址要新增、取代或略過瀏覽紀錄。
     * @returns 資料載入完成後結束。
     */
    async function openPage(page: PageSummary, historyAction: HistoryAction = 'push'): Promise<void>
    {
        const requestId = detailRequest.current + 1

        detailRequest.current = requestId
        if (!visiblePageId) browseScroll.current = window.scrollY
        scrollRestorePending.current = false

        setMessage(null)
        const domainParams = new URLSearchParams({ domain: page.domain })
        const [detailResponse, siteResponse] = await Promise.all([
            fetch(`/api/v1/pages/${page.id}`),
            fetch(`/api/v1/pages?${domainParams.toString()}`),
        ])

        if (!detailResponse.ok || !siteResponse.ok) {
            setMessage('頁面詳情載入失敗，請稍後再試。')
            return
        }

        const detailBody = await detailResponse.json() as PageDetail
        const siteBody = await siteResponse.json() as { items: PageSummary[] }

        if (detailRequest.current !== requestId) return

        setSelection(null)
        setInnerPagesFirst(false)
        setViewDetail(detailBody)
        setSitePages(siteBody.items.filter(item => item.id !== page.id))
        setSimilarPages([])
        updateDetailLocation(detailBody.id, historyAction)
    }

    /**
     * 依網址中的頁面 ID 還原三欄詳細畫面。
     *
     * @param pageId 公開頁面的穩定 ID。
     * @param historyAction 詳情網址要新增、取代或略過瀏覽紀錄。
     * @returns 詳情載入完成後結束。
     */
    async function openPageById(pageId: string, historyAction: HistoryAction): Promise<void>
    {
        const response = await fetch(`/api/v1/pages/${pageId}`)

        if (!response.ok) {
            setMessage('頁面詳情載入失敗，請稍後再試。')
            return
        }

        await openPage(await response.json() as PageDetail, historyAction)
    }

    /**
     * 只更新三欄詳細畫面所屬的網址，保留目前頁碼與搜尋條件。
     *
     * @param pageId 目前顯示的頁面 ID；null 代表回到清單網址。
     * @param action 詳情網址要新增、取代或略過瀏覽紀錄。
     * @returns 無回傳值。
     */
    function updateDetailLocation(pageId: string | null, action: HistoryAction): void
    {
        if (action === 'none') return

        const params = new URLSearchParams(window.location.search)

        if (pageId) params.set('detail', pageId)
        else params.delete('detail')

        const search = params.toString()
        const url = `${window.location.pathname}${search ? `?${search}` : ''}`

        if (action === 'push') window.history.pushState(null, '', url)
        else window.history.replaceState(null, '', url)
    }

    async function loadSimilarPages(pageVersionId: string, region: Selection): Promise<void>
    {
        setSimilarLoading(true)

        try {
            const response = await fetch('/api/v1/similar-searches', {
                body: JSON.stringify({ pageVersionId, ...region }),
                headers: { 'content-type': 'application/json' },
                method: 'POST',
            })

            if (!response.ok) return

            const body = await response.json() as { items: SimilarPage[] }

            setSimilarPages(body.items)
        }
        finally {
            setSimilarLoading(false)
        }
    }

    async function openLightbox(page: PageSummary)
    {
        setMessage(null)
        const response = await fetch(`/api/v1/pages/${page.id}`)

        if (!response.ok) {
            setMessage('原始圖片載入失敗，請稍後再試。')
            return
        }

        setLightbox(await response.json() as PageDetail)
        setLightboxActualSize(false)
    }

    function activateVisualSearch()
    {
        if (!visiblePage) return

        if (selection) {
            void loadSimilarPages(visiblePage.pageVersionId, selection)
            return
        }

        const bounds = imageRef.current?.getBoundingClientRect()
        const y = bounds
            ? clamp((window.innerHeight / 2 - bounds.top) / bounds.height)
            : 0.25

        setSelection(defaultSelectionAt({ x: 0.5, y }))
    }

    function closeLightbox()
    {
        setLightbox(null)
        setLightboxActualSize(false)
    }

    /**
     * 關閉頁面詳情；從返回按鈕離開時，等離場動畫結束再恢復清單位置。
     * @param restoreScroll 是否回到開啟詳情前的清單位置。
     * @returns 無回傳值。
     */
    function closePage(restoreScroll = true, historyAction: HistoryAction = 'replace'): void
    {
        scrollRestorePending.current = restoreScroll
        detailRequest.current += 1

        closeLightbox()
        setSelection(null)
        setViewDetail(null)
        setSitePages([])
        setSimilarPages([])
        setInnerPagesFirst(false)
        updateDetailLocation(null, historyAction)
    }

    function showHome()
    {
        closePage(false)
        setViewMode('browse')
        setPageType('')
        setSearchTag('')
        setDrawerMode(null)
        updateLocation('browse', page)
    }

    function showSavedViews()
    {
        closePage(false)
        setViewMode('saved')
        setDrawerMode(null)
        updateLocation('saved', savedPage)
    }

    /**
     * 從任一搜尋入口回到公共頁面列表並套用相同查詢。
     *
     * @param value 使用者輸入的品牌、網址或摘要關鍵字。
     * @returns 無回傳值。
     */
    function searchPages(value: string): void
    {
        setViewMode('browse')
        setSearchTag('')
        setQuery(value)
    }

    /**
     * 將頁面的公開分類轉成可分享、可重新整理的精確搜尋條件。
     *
     * @param key 公開分類的穩定識別字。
     * @returns 無回傳值。
     */
    function searchPagesByTag(key: string): void
    {
        closePage(false)
        setViewMode('browse')
        setQuery('')
        setSearchTag(key)
    }

    async function loadDetail(pageId: string)
    {
        const response = await fetch(`/api/v1/pages/${pageId}`)

        if (!response.ok) return

        setDetail(await response.json() as PageDetail)
    }

    async function loadSavedPage(pageId: string)
    {
        const response = await fetch(`/api/v1/pages/${pageId}`)

        if (!response.ok) return

        await openPage(await response.json() as PageDetail)
    }

    async function loadTags()
    {
        const response = await fetch('/api/v1/tags')

        if (!response.ok) return

        const items = (await response.json() as { items: UserTag[] }).items

        setTags(items)
        setSelectedBoardId(current => current || items[0]?.id || '')
    }

    async function loadSavedViews(targetPage: number, append: boolean)
    {
        const response = await fetch(`/api/v1/saved-views?page=${targetPage}`)

        if (!response.ok) return

        const body = await response.json() as SavedViewList

        setSavedViews(current => append ? uniqueById([...current, ...body.items]) : body.items)
        setSavedPage(body.page)
        setSavedTotal(body.total)
        setSavedHasMore(body.hasMore)

        if (viewMode === 'saved') updateLocation('saved', body.page)
    }

    async function loadNextSavedPage()
    {
        setLoading(true)

        try {
            await loadSavedViews(savedPage + 1, true)
        }
        finally {
            setLoading(false)
        }
    }

    async function createTag(): Promise<UserTag | null>
    {
        const name = newTag.trim()

        if (!name) return null

        const response = await fetch('/api/v1/tags', {
            body: JSON.stringify({ name }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        })

        if (!response.ok) {
            setMessage('版圖建立失敗，請確認名稱沒有重複。')
            return null
        }

        const created = await response.json() as UserTag

        setNewTag('')
        setTags(current => [created, ...current.filter(tag => tag.id !== created.id)])
        setSelectedBoardId(created.id)

        return created
    }

    async function uploadPage()
    {
        if (!uploadFile || !uploadName.trim() || !uploadUrl.trim()) {
            setUploadError('請填寫網站名稱、網址並選擇 PNG 截圖。')
            return
        }

        const params = new URLSearchParams({
            sourceUrl: uploadUrl.trim(),
            title: uploadName.trim(),
        })
        setUploading(true)
        setUploadError(null)

        try {
            const response = await fetch(`/api/v1/uploads?${params.toString()}`, {
                body: uploadFile,
                headers: { 'content-type': 'image/png' },
                method: 'POST',
            })

            if (!response.ok) {
                const body = await response.json() as { message?: string }

                setUploadError(body.message ?? '截圖上傳失敗，請稍後再試。')
                return
            }

            setUploadFile(null)
            setUploadName('')
            setUploadUrl('')
            if (uploadInputRef.current) uploadInputRef.current.value = ''
            showHome()
            await loadPageRange(1)
        }
        finally {
            setUploading(false)
        }
    }

    async function openSave(page: PageSummary, resetSelection = true)
    {
        setReason('')
        setBoardQuery('')
        setMessage(null)
        if (resetSelection) setSelection(null)
        setSelectedBoardId(current => current || tags[0]?.id || '')
        await loadDetail(page.id)
    }

    function closeSave()
    {
        setDetail(null)
        setDrag(null)
    }

    async function saveView()
    {
        if (!detail) return

        if (!selectedBoardId) {
            setMessage('請先選擇或建立一個版圖。')
            return
        }

        const saved = await createSavedView({
            ...(selection ?? FULL_PAGE_SELECTION),
            pageVersionId: detail.pageVersionId,
            reason: reason.trim() || null,
            tagIds: [selectedBoardId],
        })

        if (!saved) {
            setMessage('收藏失敗，請重新登入或調整框選範圍。')
            return
        }

        setMessage(`已儲存到「${selectedBoard?.name ?? '版圖'}」。`)
        setReason('')
        await loadSavedViews(1, false)
        await loadTags()
        closeSave()
    }

    async function createSavedView(input: {
        height: number
        pageVersionId: string
        reason: string | null
        tagIds: string[]
        width: number
        x: number
        y: number
    }): Promise<boolean>
    {
        const response = await fetch('/api/v1/saved-views', {
            body: JSON.stringify({
                height: input.height,
                pageVersionId: input.pageVersionId,
                reason: input.reason,
                tagIds: input.tagIds,
                width: input.width,
                x: input.x,
                y: input.y,
            }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        })

        return response.ok
    }

    function startSelection(event: React.PointerEvent<HTMLDivElement>)
    {
        if (!imageRef.current) return

        const point = toImagePoint(event)

        event.currentTarget.setPointerCapture(event.pointerId)
        setDrag({
            initial: null,
            mode: 'create',
            moved: false,
            startX: point.x,
            startY: point.y,
        })
    }

    function startSelectionMove(event: React.PointerEvent<HTMLDivElement>)
    {
        if (!selection) return

        const point = toImagePoint(event)

        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDrag({
            initial: selection,
            mode: 'move',
            moved: false,
            startX: point.x,
            startY: point.y,
        })
    }

    function startSelectionResize(event: React.PointerEvent<HTMLDivElement>, handle: ResizeHandle)
    {
        if (!selection) return

        const point = toImagePoint(event)

        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDrag({
            handle,
            initial: selection,
            mode: 'resize',
            moved: false,
            startX: point.x,
            startY: point.y,
        })
    }

    function moveDrag(event: React.PointerEvent<HTMLDivElement>)
    {
        if (!drag) return

        const point = toImagePoint(event)
        const deltaX = point.x - drag.startX
        const deltaY = point.y - drag.startY

        if (drag.mode === 'create') {
            const x = Math.min(drag.startX, point.x)
            const y = Math.min(drag.startY, point.y)

            setSelection({
                height: Math.max(Math.min(Math.abs(deltaY), 1 - y), 0.01),
                width: Math.max(Math.min(Math.abs(deltaX), 1 - x), 0.01),
                x,
                y,
            })
        }

        if (drag.mode === 'move' && drag.initial) {
            setSelection({
                ...drag.initial,
                x: Math.min(Math.max(drag.initial.x + deltaX, 0), 1 - drag.initial.width),
                y: Math.min(Math.max(drag.initial.y + deltaY, 0), 1 - drag.initial.height),
            })
        }

        if (drag.mode === 'resize' && drag.initial && drag.handle) {
            const minimumSize = 0.03
            let left = drag.initial.x
            let right = drag.initial.x + drag.initial.width
            let top = drag.initial.y
            let bottom = drag.initial.y + drag.initial.height

            if (drag.handle.includes('w')) left = Math.min(Math.max(drag.initial.x + deltaX, 0), right - minimumSize)
            if (drag.handle.includes('e')) right = Math.max(Math.min(right + deltaX, 1), left + minimumSize)
            if (drag.handle.includes('n')) top = Math.min(Math.max(drag.initial.y + deltaY, 0), bottom - minimumSize)
            if (drag.handle.includes('s')) bottom = Math.max(Math.min(bottom + deltaY, 1), top + minimumSize)

            setSelection({
                height: bottom - top,
                width: right - left,
                x: left,
                y: top,
            })
        }

        if (!drag.moved && Math.hypot(deltaX, deltaY) > 0.008) {
            setDrag({ ...drag, moved: true })
        }
    }

    function finishSelection(event: React.PointerEvent<HTMLDivElement>)
    {
        if (drag?.mode === 'create' && !drag.moved) {
            setSelection(defaultSelectionAt(toImagePoint(event)))
        }

        setDrag(null)
    }

    function defaultSelectionAt(point: { x: number, y: number }): Selection
    {
        const imageHeight = imageRef.current?.getBoundingClientRect().height ?? 360
        const height = Math.min(Math.max(220 / imageHeight, 0.08), 0.55)
        const width = 0.72

        return {
            height,
            width,
            x: Math.min(Math.max(point.x - width / 2, 0), 1 - width),
            y: Math.min(Math.max(point.y - height / 2, 0), 1 - height),
        }
    }

    function toImagePoint(event: React.PointerEvent<HTMLDivElement>)
    {
        const rect = imageRef.current?.getBoundingClientRect()

        if (!rect) return { x: 0, y: 0 }

        return {
            x: clamp((event.clientX - rect.left) / rect.width),
            y: clamp((event.clientY - rect.top) / rect.height),
        }
    }

    const pageCountLabel = pageType === 'home'
        ? '張首頁截圖'
        : pageType
            ? '張頁面截圖'
            : '張已收錄頁面'

    if (!authenticated) {
        return (
            <main className="workspace-loading">
                {message ? (
                    <>
                        <InlineMessage tone="danger">{message}</InlineMessage>
                        <Button onClick={() => void login()} type="button">重新連線</Button>
                    </>
                ) : (
                    <>
                        <Spinner />
                        <span>正在開啟 SiteSensory…</span>
                    </>
                )}
            </main>
        )
    }

    return (
        <TooltipProvider>
        <main className={visiblePage ? 'workspace is-page-open' : 'workspace'}>
            <nav className="rail" aria-label="主要工具">
                <RailAction
                    className="rail-logo"
                    icon={<SiteSensoryMark />}
                    label="SiteSensory 首頁"
                    onClick={showHome}
                />
                <RailAction icon={<Home size={28} />} label="首頁清單" onClick={showHome} />
                <RailAction icon={<Filter size={28} />} label="篩選網站" onClick={() => setDrawerMode('search')} />
                <RailAction icon={<BoardGridIcon />} label="我的收藏版圖" onClick={() => {
                    showSavedViews()
                    setDrawerMode('board')
                }} />
                <RailAction icon={<Plus size={28} />} label="新增網站截圖" onClick={() => setDrawerMode('upload')} />
                <RailAction icon={<Bell size={28} />} label="留言通知" onClick={() => setDrawerMode('notifications')} />
                <RailAction disabled icon={<Info size={28} />} label="訊息（尚未開放）" />
            </nav>

            <Drawer
                open={drawerMode !== null}
                onOpenChange={open => {
                    if (!open) setDrawerMode(null)
                }}
                position="start"
                size="md"
            >
                <DrawerContent className="filter-drawer">
                    <DrawerHeader className="sr-only">
                        <DrawerTitle>
                            {drawerMode === 'board' && '我的收藏版圖'}
                            {drawerMode === 'search' && '篩選網站'}
                            {drawerMode === 'upload' && '新增網站截圖'}
                            {drawerMode === 'notifications' && '留言通知'}
                        </DrawerTitle>
                        <DrawerDescription>
                            {drawerMode === 'board'
                                ? '管理收藏視角使用的私人分類。'
                                : drawerMode === 'upload'
                                    ? '上傳 1920px 寬的網站完整截圖。'
                                    : drawerMode === 'notifications'
                                        ? '查看自己上傳頁面收到的留言。'
                                        : '搜尋已收錄頁面，或使用語言與內頁類型縮小範圍。'}
                        </DrawerDescription>
                    </DrawerHeader>
                    <DrawerCloseButton aria-label="關閉側欄" />
                    {drawerMode === 'search' && (
                        <DrawerBody className="filter-body">
                            <div className="field">
                                <Label htmlFor="design-search"><Search size={15} />搜尋網站</Label>
                                <Input
                                    id="design-search"
                                    onChange={event => searchPages(event.target.value)}
                                    placeholder="品牌、網址、摘要"
                                    value={query}
                                />
                            </div>

                            <FilterTagGroup
                                label="語言"
                                onChange={setLanguage}
                                options={[
                                    { label: '全部', value: '' },
                                    ...languages.map(item => ({ label: LANGUAGE_NAMES.of(item) ?? item, value: item })),
                                ]}
                                value={language}
                            />

                            <FilterTagGroup
                                label="內頁類型"
                                onChange={setPageType}
                                options={PAGE_TYPE_FILTER_OPTIONS}
                                value={pageType}
                            />
                        </DrawerBody>
                    )}
                    {drawerMode === 'board' && (
                        <DrawerBody className="filter-body board-body">
                            <div className="board-heading">
                                <List size={20} />
                                <div>
                                    <strong>我的收藏版圖</strong>
                                    <span>{savedTotal} 個收藏視角</span>
                                </div>
                            </div>
                            <Card className="panel board-panel" size="sm">
                                <CardHeader>
                                    <CardTitle><List size={16} />我的版圖</CardTitle>
                                    <CardDescription>選取一個預設版圖，儲存時仍可快速切換。</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="tag-create">
                                        <Input
                                            aria-label="建立新版圖"
                                            onChange={event => setNewTag(event.target.value)}
                                            onKeyDown={event => {
                                                if (event.key === 'Enter') void createTag()
                                            }}
                                            placeholder="新版圖名稱"
                                            value={newTag}
                                        />
                                        <Button onClick={() => void createTag()} size="sm" type="button">新增</Button>
                                    </div>
                                    <div className="tags">
                                        {tags.map(tag => (
                                            <Button
                                                appearance={selectedBoardId === tag.id ? 'soft' : 'outline'}
                                                aria-pressed={selectedBoardId === tag.id}
                                                key={tag.id}
                                                onClick={() => setSelectedBoardId(tag.id)}
                                                size="sm"
                                                tone={selectedBoardId === tag.id ? 'primary' : 'light'}
                                                type="button"
                                            >
                                                {tag.name}
                                            </Button>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </DrawerBody>
                    )}
                    {drawerMode === 'upload' && (
                        <DrawerBody className="filter-body upload-body">
                            <div className="board-heading">
                                <Plus size={24} />
                                <div>
                                    <strong>新增網站截圖</strong>
                                    <span>圖片會建立為新的首頁設計資料。</span>
                                </div>
                            </div>
                            <div className="field">
                                <Label htmlFor="upload-name">網站名稱</Label>
                                <Input
                                    id="upload-name"
                                    onChange={event => setUploadName(event.target.value)}
                                    placeholder="例如：品牌官方網站"
                                    value={uploadName}
                                />
                            </div>
                            <div className="field">
                                <Label htmlFor="upload-url">網址</Label>
                                <Input
                                    id="upload-url"
                                    onChange={event => setUploadUrl(event.target.value)}
                                    placeholder="https://example.com"
                                    type="url"
                                    value={uploadUrl}
                                />
                            </div>
                            <div className="field">
                                <Label htmlFor="upload-image">網頁截圖</Label>
                                <Input
                                    accept="image/png"
                                    id="upload-image"
                                    onChange={event => setUploadFile(event.target.files?.[0] ?? null)}
                                    ref={uploadInputRef}
                                    type="file"
                                />
                                <span className="field-note">使用 1920px 寬的 PNG 完整頁面截圖。</span>
                            </div>
                            {uploadError && <InlineMessage tone="danger">{uploadError}</InlineMessage>}
                            <Button disabled={uploading} onClick={() => void uploadPage()} type="button">
                                {uploading ? <><Spinner />上傳中</> : '建立圖片'}
                            </Button>
                        </DrawerBody>
                    )}
                    {drawerMode === 'notifications' && (
                        <DrawerBody className="filter-body notification-body">
                            <Bell size={38} />
                            <strong>目前沒有留言通知</strong>
                            <span>自己上傳的網站截圖收到留言後，會顯示在這裡。</span>
                        </DrawerBody>
                    )}
                </DrawerContent>
            </Drawer>

            <header className="top-search">
                <div className="top-search-shell">
                    <Search aria-hidden="true" size={18} />
                    <Input
                        aria-label="搜尋網站設計"
                        onChange={event => searchPages(event.target.value)}
                        placeholder="搜尋品牌、網址或摘要"
                        type="search"
                        value={query}
                    />
                    <Button
                        aria-label="開啟搜尋條件"
                        appearance="ghost"
                        iconOnly
                        onClick={() => setDrawerMode('search')}
                        size="sm"
                        tone="muted"
                        type="button"
                    >
                        <Filter size={18} />
                    </Button>
                </div>
            </header>

            <section className="gallery" aria-label={viewMode === 'browse' ? '網站設計列表' : '我的收藏版圖'}>
                {viewMode === 'browse' ? (
                    <>
                        <div className="toolbar">
                            <div>
                                <strong>{pageTotal}</strong>
                                <span> {pageCountLabel}</span>
                            </div>
                            {searchTag && (
                                <Button
                                    appearance="soft"
                                    aria-label={`清除標籤 ${searchTag}`}
                                    className="active-search-tag"
                                    onClick={() => setSearchTag('')}
                                    size="sm"
                                    tone="muted"
                                    type="button"
                                >
                                    #{searchTag}
                                    <X size={14} />
                                </Button>
                            )}
                            <span className="scope-note">
                                已載入 {displayedPages.length} 張 · 第 {page} 頁
                            </span>
                            {loading && <span className="loading" role="status"><Spinner />讀取中</span>}
                        </div>

                        <div className="gallery-grid" ref={galleryGridRef}>
                            {displayedPages.map(item => {
                                const savedView = savedViews.find(view => view.pageId === item.id)
                                const savedBoard = savedView
                                    ? tags.find(tag => savedView.tagIds.includes(tag.id)) ?? null
                                    : null
                                const boardLabel = savedBoard?.name ?? (savedView ? '已收藏' : '選擇版圖')

                                return (
                                    <Card asChild className="gallery-card" key={item.id} size="sm">
                                        <article>
                                        <Button
                                            appearance="ghost"
                                            className="card-image"
                                            onClick={() => void openPage(item)}
                                            tone="muted"
                                            type="button"
                                        >
                                            <img alt={item.title} loading="lazy" src={item.thumbnailAssetUrl} />
                                        </Button>
                                        <Dropdown>
                                            <DropdownTrigger asChild>
                                                <Button
                                                    aria-label={savedView
                                                        ? `「${item.title}」已收藏到「${boardLabel}」，選擇版圖`
                                                        : `選擇「${item.title}」要儲存的版圖`}
                                                    className={savedView ? 'card-board-select is-saved' : 'card-board-select'}
                                                    size="sm"
                                                    tone="dark"
                                                    type="button"
                                                >
                                                    <span aria-hidden="true" className="card-heart-icon">
                                                        {savedView ? '♥' : '♡'}
                                                    </span>
                                                    <span className="card-board-label">{boardLabel}</span>
                                                    <ChevronDown className="card-board-chevron" size={18} />
                                                </Button>
                                            </DropdownTrigger>
                                            <DropdownContent align="start" className="board-quick-menu" size="md">
                                                <DropdownRadioGroup onValueChange={setSelectedBoardId} value={selectedBoardId}>
                                                    {tags.map(tag => (
                                                        <DropdownRadioItem key={tag.id} value={tag.id}>
                                                            {tag.name}
                                                        </DropdownRadioItem>
                                                    ))}
                                                </DropdownRadioGroup>
                                                {tags.length > 0 && <DropdownSeparator />}
                                                <DropdownItem onSelect={() => void openSave(item)}>
                                                    <Plus size={16} />
                                                    管理與建立版圖
                                                </DropdownItem>
                                            </DropdownContent>
                                        </Dropdown>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    aria-label={`儲存「${item.title}」`}
                                                    className="quick-save"
                                                    iconOnly
                                                    onClick={() => void openSave(item)}
                                                    size="sm"
                                                    type="button"
                                                >
                                                    <span aria-hidden="true" className="quick-save-icon">♡</span>
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>儲存</TooltipContent>
                                        </Tooltip>
                                        <Button asChild className="quick-url" size="sm" tone="muted">
                                            <a
                                                aria-label={`${item.title} 網址（開新分頁）`}
                                                href={item.sourceUrl}
                                                rel="noreferrer"
                                                target="_blank"
                                            >
                                                <ExternalLink size={15} />
                                                網址
                                            </a>
                                        </Button>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    appearance="soft"
                                                    aria-label={`全螢幕檢視「${item.title}」`}
                                                    className="quick-lightbox"
                                                    iconOnly
                                                    onClick={() => void openLightbox(item)}
                                                    size="sm"
                                                    tone="light"
                                                    type="button"
                                                >
                                                    <ArrowsMaximize size={20} />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>全螢幕檢視</TooltipContent>
                                        </Tooltip>
                                        </article>
                                    </Card>
                                )
                            })}
                        </div>

                        {!loading && displayedPages.length === 0 && (
                            <InlineMessage appearance="soft" className="empty" tone="info">
                                {query || language || pageType || searchTag
                                    ? '沒有符合目前搜尋條件的頁面，請調整或清除篩選條件。'
                                    : '目前沒有資料。先執行 dbcut 匯入後，這裡會出現網站設計卡片。'}
                            </InlineMessage>
                        )}
                        <div aria-hidden="true" className="load-sentinel" ref={pageSentinelRef} />
                    </>
                ) : (
                    <>
                        <div className="toolbar">
                            <div>
                                <strong>{savedTotal}</strong>
                                <span> 個收藏視角</span>
                            </div>
                            <span className="scope-note">已載入 {savedViews.length} 個 · 第 {savedPage} 頁</span>
                            {loading && <span className="loading" role="status"><Spinner />讀取中</span>}
                        </div>
                        <div className="gallery-grid saved-board" ref={galleryGridRef}>
                            {savedViews.map(view => (
                                <Card asChild className="saved-view-card" key={view.id} size="sm">
                                    <article>
                                        <Button
                                            appearance="ghost"
                                            className="saved-view-image"
                                            onClick={() => void loadSavedPage(view.pageId)}
                                            tone="muted"
                                            type="button"
                                        >
                                            <img alt={`${view.title} 收藏視角`} loading="lazy" src={view.previewAssetUrl} />
                                        </Button>
                                        <CardContent>
                                            {view.reason?.trim() && <strong>{view.reason.trim()}</strong>}
                                            <CardDescription>{new Date(view.createdAt).toLocaleDateString('zh-TW')}</CardDescription>
                                        </CardContent>
                                    </article>
                                </Card>
                            ))}
                        </div>
                        {!loading && savedViews.length === 0 && (
                            <InlineMessage appearance="soft" className="empty" tone="info">
                                尚未收藏頁面。從首頁清單選擇「儲存」即可建立自己的版圖。
                            </InlineMessage>
                        )}
                        <div aria-hidden="true" className="load-sentinel" ref={savedSentinelRef} />
                    </>
                )}
            </section>

            {visiblePage && (
                <div
                    className={pagePresence.closing ? 'page-layer is-closing' : 'page-layer'}
                >
                    <div className="page-layout">
                        <section className="page-primary">
                            <Card className="page-detail-card" size="md">
                                <div className="page-info">
                                    <CardContent className="page-info-content">
                                        <CardTitle asChild><h1>{visiblePage.title}</h1></CardTitle>
                                        {visiblePage.tags.length > 0 ? (
                                            <div aria-label="搜尋標籤" className="page-search-tags" role="group">
                                                {visiblePage.tags.map(tag => (
                                                    <Button
                                                        appearance="soft"
                                                        key={`${tag.group}:${tag.key}`}
                                                        onClick={() => searchPagesByTag(tag.key)}
                                                        size="sm"
                                                        tone="muted"
                                                        type="button"
                                                    >
                                                        #{tag.name}
                                                    </Button>
                                                ))}
                                            </div>
                                        ) : (
                                            <CardDescription className="page-tag-empty">尚未分析搜尋標籤</CardDescription>
                                        )}
                                    </CardContent>
                                    <div className="page-actions">
                                        <Button appearance="outline" className="page-action-button" onClick={() => closePage()} size="sm" tone="light" type="button">
                                            <ArrowLeft size={16} />
                                            返回
                                        </Button>
                                        <Button appearance="outline" asChild className="page-action-button" size="sm" tone="light">
                                            <a href={visiblePage.sourceUrl} rel="noreferrer" target="_blank">
                                                <Link size={16} />
                                                網址
                                            </a>
                                        </Button>
                                        <Button
                                            appearance={innerPagesFirst ? 'soft' : 'outline'}
                                            aria-pressed={innerPagesFirst}
                                            className="page-action-button"
                                            onClick={() => setInnerPagesFirst(current => !current)}
                                            size="sm"
                                            tone={innerPagesFirst ? 'primary' : 'light'}
                                            type="button"
                                        >
                                            內頁
                                        </Button>
                                        <Dropdown>
                                            <DropdownTrigger asChild>
                                                <Button appearance="outline" className="board-quick-select" size="sm" tone="dark" type="button">
                                                    {selectedBoard?.name ?? '選擇版圖'}
                                                    <ChevronDown size={16} />
                                                </Button>
                                            </DropdownTrigger>
                                            <DropdownContent align="end" className="board-quick-menu" size="md">
                                                <DropdownRadioGroup onValueChange={setSelectedBoardId} value={selectedBoardId}>
                                                    {tags.map(tag => (
                                                        <DropdownRadioItem key={tag.id} value={tag.id}>
                                                            {tag.name}
                                                        </DropdownRadioItem>
                                                    ))}
                                                </DropdownRadioGroup>
                                                {tags.length > 0 && <DropdownSeparator />}
                                                <DropdownItem onSelect={() => void openSave(visiblePage, false)}>
                                                    <Plus size={16} />
                                                    管理與建立版圖
                                                </DropdownItem>
                                            </DropdownContent>
                                        </Dropdown>
                                        <Button className="page-action-button save-action-button" onClick={() => void openSave(visiblePage, false)} size="sm" type="button">
                                            <span aria-hidden="true" className="heart-icon">♡</span>
                                            儲存
                                        </Button>
                                    </div>
                                </div>
                                <div className="page-preview">
                                    <div
                                        aria-label={`框選 ${visiblePage.title} 的收藏視角`}
                                        className={selection ? 'page-selection-canvas is-selecting' : 'page-selection-canvas'}
                                        onKeyDown={event => {
                                            if (event.key !== 'Enter' && event.key !== ' ') return

                                            event.preventDefault()
                                            setSelection(current => current ?? defaultSelectionAt({ x: 0.5, y: 0.25 }))
                                        }}
                                        onPointerCancel={finishSelection}
                                        onPointerDown={startSelection}
                                        onPointerMove={moveDrag}
                                        onPointerUp={finishSelection}
                                        role="button"
                                        tabIndex={0}
                                    >
                                        <div
                                            aria-label="圖片工具"
                                            className="page-preview-controls"
                                            onPointerDown={event => event.stopPropagation()}
                                            role="group"
                                        >
                                            <Button
                                                appearance="soft"
                                                aria-label="放大檢視"
                                                className="page-preview-control"
                                                onClick={event => {
                                                    event.stopPropagation()
                                                    void openLightbox(visiblePage)
                                                }}
                                                size="md"
                                                tone="light"
                                                type="button"
                                            >
                                                <span>放大檢視</span>
                                                <ArrowsMaximize size={22} />
                                            </Button>
                                            <Button
                                                appearance="soft"
                                                aria-label="搜尋圖片"
                                                className="page-preview-control"
                                                onClick={event => {
                                                    event.stopPropagation()
                                                    activateVisualSearch()
                                                }}
                                                size="md"
                                                tone="light"
                                                type="button"
                                            >
                                                <span>搜尋圖片</span>
                                                <span aria-hidden="true" className="visual-search-icon">
                                                    <Search size={23} />
                                                    <Sparkles size={12} />
                                                </span>
                                            </Button>
                                        </div>
                                        <img
                                            alt={`${visiblePage.title} 完整頁面`}
                                            draggable={false}
                                            ref={imageRef}
                                            src={visiblePage.fullPageAssetUrl}
                                        />
                                        {currentBoard && <span className="page-board-badge">{currentBoard.name}</span>}
                                        {!selection && <span className="selection-hint">點擊或拖曳以選取視角</span>}
                                        {selection && (
                                            <div
                                                aria-label="目前選取的收藏視角"
                                                className="selection"
                                                onPointerDown={startSelectionMove}
                                                style={{
                                                    height: `${selection.height * 100}%`,
                                                    left: `${selection.x * 100}%`,
                                                    top: `${selection.y * 100}%`,
                                                    width: `${selection.width * 100}%`,
                                                }}
                                            >
                                                <Button
                                                    aria-label="清除框選"
                                                    className="selection-clear"
                                                    iconOnly
                                                    onClick={event => {
                                                        event.stopPropagation()
                                                        setSelection(null)
                                                    }}
                                                    onPointerDown={event => event.stopPropagation()}
                                                    size="sm"
                                                    type="button"
                                                >
                                                    <X size={18} />
                                                </Button>
                                                {RESIZE_HANDLES.map(handle => (
                                                    <div
                                                        aria-label={RESIZE_HANDLE_LABELS[handle]}
                                                        className={`selection-handle is-${handle}`}
                                                        key={handle}
                                                        onPointerDown={event => startSelectionResize(event, handle)}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </Card>

                        </section>

                        <aside aria-label="相關網站設計" className="similar-section">
                            <div
                                className={similarLoading ? 'similar-grid is-loading' : 'similar-grid'}
                                ref={relatedGridRef}
                            >
                                {relatedPages.map(page => (
                                    <Button
                                        appearance="ghost"
                                        className="image-button"
                                        key={page.id}
                                        onClick={() => void openPage(page)}
                                        tone="muted"
                                        type="button"
                                    >
                                        <img alt={page.title} loading="lazy" src={page.thumbnailAssetUrl} />
                                    </Button>
                                ))}
                            </div>
                            {relatedPages.length === 0 && (
                                <InlineMessage appearance="soft" className="empty compact-empty" tone="info">
                                    目前沒有相關圖片。
                                </InlineMessage>
                            )}
                        </aside>
                    </div>
                </div>
            )}

            <Dialog
                onOpenChange={open => {
                    if (!open) closeSave()
                }}
                open={detail !== null}
            >
                {visibleSave && (
                    <DialogContent className="save-dialog" closeLabel="關閉儲存視窗" scrollable size="md">
                        <DialogHeader>
                            <DialogTitle>儲存視角</DialogTitle>
                            <DialogDescription>
                                {selection
                                    ? '儲存目前框選的區域，並選擇要加入的版圖。'
                                    : '儲存整個頁面，並選擇要加入的版圖。'}
                            </DialogDescription>
                        </DialogHeader>
                        <DialogBody className="save-dialog-body">
                            <Input
                                aria-label="搜尋版圖"
                                onChange={event => setBoardQuery(event.target.value)}
                                placeholder="搜尋版圖"
                                type="search"
                                value={boardQuery}
                            />

                            <div className="board-list" role="radiogroup" aria-label="選擇版圖">
                                {tags
                                    .filter(tag => tag.name.toLocaleLowerCase().includes(boardQuery.trim().toLocaleLowerCase()))
                                    .map(tag => {
                                        const preview = savedViews.find(view => view.tagIds.includes(tag.id))
                                        const selected = selectedBoardId === tag.id

                                        return (
                                            <Button
                                                appearance="ghost"
                                                aria-checked={selected}
                                                className={selected ? 'board-option is-selected' : 'board-option'}
                                                key={tag.id}
                                                onClick={() => setSelectedBoardId(tag.id)}
                                                role="radio"
                                                tone="muted"
                                                type="button"
                                            >
                                                {preview
                                                    ? <img alt="" src={preview.previewAssetUrl} />
                                                    : <span aria-hidden="true" className="board-placeholder"><List size={20} /></span>}
                                                <span>{tag.name}</span>
                                                {selected && <strong>已選擇</strong>}
                                            </Button>
                                        )
                                    })}
                                {tags.length === 0 && (
                                    <CardDescription>尚未建立版圖，請先在下方新增。</CardDescription>
                                )}
                            </div>

                            <div className="board-create">
                                <Input
                                    aria-label="新版圖名稱"
                                    onChange={event => setNewTag(event.target.value)}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter') void createTag()
                                    }}
                                    placeholder="新版圖名稱"
                                    value={newTag}
                                />
                                <Button onClick={() => void createTag()} type="button">
                                    <Plus size={16} />
                                    建立
                                </Button>
                            </div>

                            <div className="save-note">
                                <Label htmlFor="save-reason">備註</Label>
                                <Input
                                    id="save-reason"
                                    onChange={event => setReason(event.target.value)}
                                    placeholder="寫下收藏這個視角的原因"
                                    value={reason}
                                />
                            </div>
                            {message && <InlineMessage tone="info">{message}</InlineMessage>}
                        </DialogBody>
                        <DialogFooter>
                            <Button appearance="outline" onClick={closeSave} tone="light" type="button">取消</Button>
                            <Button className="save-action-button" disabled={!selectedBoardId} onClick={() => void saveView()} type="button">
                                <span aria-hidden="true" className="heart-icon">♡</span>
                                儲存到{selectedBoard ? `「${selectedBoard.name}」` : '版圖'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                )}
            </Dialog>

            {lightbox && (
                <div
                    className="lightbox"
                    onMouseDown={event => {
                        if (event.target === event.currentTarget) closeLightbox()
                    }}
                >
                    <Card aria-modal="true" className="lightbox-dialog" role="dialog" size="md">
                        <header className="lightbox-toolbar">
                            <div>
                                <strong>{lightbox.title}</strong>
                                <span>原始解析度 {lightbox.width ?? 1920} × {lightbox.height ?? '未知'} px</span>
                            </div>
                            <div className="lightbox-actions">
                                <Button
                                    appearance="outline"
                                    onClick={() => setLightboxActualSize(current => !current)}
                                    size="sm"
                                    tone="light"
                                    type="button"
                                >
                                    {lightboxActualSize ? '適合視窗' : '1:1 原始尺寸'}
                                </Button>
                                <Button
                                    aria-label="關閉完整圖片"
                                    appearance="outline"
                                    autoFocus
                                    iconOnly
                                    onClick={closeLightbox}
                                    size="sm"
                                    tone="light"
                                    type="button"
                                >
                                    <X size={18} />
                                </Button>
                            </div>
                        </header>
                        <div className={lightboxActualSize ? 'lightbox-canvas is-actual' : 'lightbox-canvas'}>
                            <img alt={`${lightbox.title} 原始完整圖片`} src={lightbox.fullPageAssetUrl} />
                        </div>
                    </Card>
                </div>
            )}
        </main>
        </TooltipProvider>
    )
}

const PAGE_TYPE_FILTER_OPTIONS = [
    { label: '全部', value: '' },
    ...PAGE_TYPE_SEEDS.map(item => ({ label: item.name, value: item.key })),
]

const LANGUAGE_NAMES = new Intl.DisplayNames(['zh-Hant'], { type: 'language' })

const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'se']

const RESIZE_HANDLE_LABELS: Record<ResizeHandle, string> = {
    nw: '向左上調整選取範圍',
    se: '向右下調整選取範圍',
}

const FULL_PAGE_SELECTION: Selection = {
    height: 1,
    width: 1,
    x: 0,
    y: 0,
}

type RailActionProps = {
    className?: string
    disabled?: boolean
    icon: React.ReactNode
    label: string
    onClick?: () => void
}

type FilterTagGroupProps = {
    label: string
    onChange: (value: string) => void
    options: ReadonlyArray<{ label: string, value: string }>
    value: string
}

/**
 * 以直接可見的標籤取代下拉選單，讓目前篩選與可用選項同時可見。
 *
 * @param props 標題、選項、目前選值與變更事件。
 * @returns 可取消選取的 Keel 標籤按鈕群組。
 */
function FilterTagGroup(props: FilterTagGroupProps)
{
    return (
        <div className="field filter-tags">
            <Label><Filter size={15} />{props.label}</Label>
            <div aria-label={props.label} className="tags" role="group">
                {props.options.map(option => {
                    const selected = props.value === option.value

                    return (
                        <Button
                            appearance={selected ? 'soft' : 'outline'}
                            aria-pressed={selected}
                            key={option.value || 'all'}
                            onClick={() => props.onChange(selected && option.value ? '' : option.value)}
                            size="sm"
                            tone={selected ? 'primary' : 'light'}
                            type="button"
                        >
                            {option.label}
                        </Button>
                    )
                })}
            </div>
        </div>
    )
}

/**
 * 依卡片實際高度計算 CSS Grid 的列跨度，保持瀑布流並保留由左往右的資料順序。
 * @param grid 要套用瀑布流的網格元素。
 * @param selector 網格內需要計算高度的卡片選擇器。
 * @returns 停止監聽尺寸變化的清理函式。
 */
function observeMasonryGrid(grid: HTMLDivElement | null, selector: string): () => void
{
    if (!grid) return () => undefined

    const layout = () => {
        const styles = window.getComputedStyle(grid)
        const rowHeight = Number.parseFloat(styles.gridAutoRows)
        const rowGap = Number.parseFloat(styles.rowGap)

        for (const card of grid.querySelectorAll<HTMLElement>(selector)) {
            const span = Math.max(1, Math.ceil((card.offsetHeight + rowGap) / (rowHeight + rowGap)))
            const value = `span ${span}`

            if (card.style.gridRowEnd !== value) card.style.gridRowEnd = value
        }
    }
    const observer = new ResizeObserver(layout)

    observer.observe(grid)

    for (const card of grid.querySelectorAll<HTMLElement>(selector)) {
        observer.observe(card)
    }

    layout()

    return () => observer.disconnect()
}

/**
 * 直接設定文件捲動位置，避免全站平滑捲動讓頁面切換後停在中間狀態。
 * @param top 文件頂端到目標位置的距離。
 * @returns 無回傳值。
 */
function setDocumentScroll(top: number): void
{
    const root = document.documentElement
    const previousBehavior = root.style.scrollBehavior

    root.style.scrollBehavior = 'auto'
    window.scrollTo({ behavior: 'auto', left: 0, top })
    root.scrollTop = top
    document.body.scrollTop = top

    window.requestAnimationFrame(() => {
        window.scrollTo({ behavior: 'auto', left: 0, top })

        window.requestAnimationFrame(() => {
            root.style.scrollBehavior = previousBehavior
        })
    })
}

/**
 * 合併曾經從 API 看過的語言，避免套用篩選後其他語言選項消失。
 *
 * @param current 已知語言代碼。
 * @param pages 新載入的頁面資料。
 * @returns 去重並排序後的語言代碼。
 */
function mergeLanguages(current: string[], pages: PageSummary[]): string[]
{
    const discovered = pages.map(page => page.language).filter(Boolean) as string[]

    return [...new Set([...current, ...discovered])].sort()
}

/**
 * 顯示 SiteSensory 的品牌標誌；四角框代表截圖視角，中央圓點代表設計辨識。
 *
 * @returns 適合側欄按鈕使用的向量標誌。
 */
function SiteSensoryMark()
{
    return (
        <svg aria-hidden="true" className="brand-mark" fill="none" viewBox="0 0 24 24">
            <path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3" />
            <circle cx="12" cy="12" r="3.25" />
            <circle className="brand-focus" cx="12" cy="12" r="1.15" />
        </svg>
    )
}

/**
 * 以多個版塊表示使用者建立的收藏版圖。
 *
 * @returns 適合側欄大尺寸顯示的版圖圖示。
 */
function BoardGridIcon()
{
    return (
        <svg aria-hidden="true" className="board-grid-icon" fill="none" viewBox="0 0 24 24">
            <rect height="8" rx="1.5" width="8" x="3" y="3" />
            <rect height="5" rx="1.5" width="7" x="14" y="3" />
            <rect height="10" rx="1.5" width="7" x="14" y="11" />
            <rect height="7" rx="1.5" width="8" x="3" y="14" />
        </svg>
    )
}

/**
 * 讓側欄操作共用 Keel Button 與 Tooltip，避免圖示按鈕各自實作焦點與提示。
 *
 * @param props 圖示、可及名稱與操作事件。
 * @returns 具提示文字的側欄操作。
 */
function RailAction(props: RailActionProps)
{
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    aria-label={props.label}
                    appearance="ghost"
                    className={props.className}
                    disabled={props.disabled}
                    iconOnly
                    onClick={props.onClick}
                    size="lg"
                    tone="muted"
                    type="button"
                >
                    {props.icon}
                </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{props.label}</TooltipContent>
        </Tooltip>
    )
}

function clamp(value: number): number
{
    return Math.min(Math.max(value, 0), 1)
}

function readPageNumber(): number
{
    const value = Number(new URLSearchParams(window.location.search).get('page') ?? '1')

    return Number.isInteger(value) && value > 0 ? value : 1
}

function readViewMode(): ViewMode
{
    return new URLSearchParams(window.location.search).get('view') === 'saved' ? 'saved' : 'browse'
}

function readSearchTag(): string
{
    return new URLSearchParams(window.location.search).get('tag')?.trim() ?? ''
}

/**
 * 從目前網址讀取三欄詳細畫面所屬的公開頁面 ID。
 *
 * @returns 網址中的頁面 ID；清單網址沒有指定圖片時回傳空字串。
 */
function readDetailPageId(): string
{
    return new URLSearchParams(window.location.search).get('detail')?.trim() ?? ''
}

function uniqueById<T extends { id: string }>(items: T[]): T[]
{
    return [...new Map(items.map(item => [item.id, item])).values()]
}

/**
 * 保留即將關閉的內容，讓浮動介面有時間完成離場動畫。
 *
 * @param value 目前應顯示的資料。
 * @param duration 離場動畫毫秒數。
 * @returns 動畫期間仍可渲染的資料與關閉狀態。
 */
function usePresence<T>(value: T | null, duration: number): Presence<T>
{
    const [rendered, setRendered] = useState<T | null>(value)
    const [closing, setClosing] = useState(false)

    useEffect(() => {
        if (value !== null) {
            setRendered(value)
            setClosing(false)
            return
        }

        if (rendered === null) return

        setClosing(true)
        const timeout = window.setTimeout(() => {
            setRendered(null)
            setClosing(false)
        }, duration)

        return () => window.clearTimeout(timeout)
    }, [duration, rendered, value])

    return { closing, value: rendered }
}
