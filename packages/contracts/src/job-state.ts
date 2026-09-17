export const JOB_STATES = [
    'queued',
    'resolving',
    'capturing',
    'comparing',
    'embedding',
    'awaiting_analysis',
    'analyzing',
    'quality_check',
    'published',
    'unchanged',
    'review_required',
    'failed',
    'rejected',
] as const

export type JobState = typeof JOB_STATES[number]

export const JOB_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = Object.freeze({
    analyzing: ['quality_check', 'failed'],
    awaiting_analysis: ['analyzing', 'failed'],
    capturing: ['comparing', 'failed'],
    comparing: ['unchanged', 'embedding', 'review_required', 'failed'],
    embedding: ['awaiting_analysis', 'failed'],
    failed: ['resolving', 'capturing', 'embedding', 'awaiting_analysis', 'rejected'],
    published: [],
    quality_check: ['published', 'review_required', 'failed'],
    queued: ['resolving'],
    rejected: [],
    resolving: ['capturing', 'failed'],
    review_required: ['comparing', 'awaiting_analysis', 'quality_check', 'rejected'],
    unchanged: [],
})

/**
 * 判斷收錄工作能否從目前狀態進入下一個狀態。
 *
 * @param current 目前狀態。
 * @param next 預計進入的狀態。
 * @returns 狀態轉換是否符合契約。
 */
export function canTransitionJob(current: JobState, next: JobState): boolean
{
    return JOB_TRANSITIONS[current].includes(next)
}

/**
 * 阻止服務層寫入契約以外的工作狀態。
 *
 * @param current 目前狀態。
 * @param next 預計進入的狀態。
 * @returns 狀態合法時不回傳內容。
 */
export function assertJobTransition(current: JobState, next: JobState): void
{
    if (!canTransitionJob(current, next)) {
        throw new Error(`不允許工作從 ${current} 轉換成 ${next}`)
    }
}
