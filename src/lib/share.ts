const DEFAULT_SHARE_URL = 'https://daka-tan.vercel.app'
const SHARE_URL_OVERRIDE = (import.meta.env.VITE_SHARE_URL ?? DEFAULT_SHARE_URL).trim()

export function buildShareUrl(): string {
  if (typeof window === 'undefined') {
    return SHARE_URL_OVERRIDE
  }

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return SHARE_URL_OVERRIDE
  }

  const url = new URL(window.location.pathname, window.location.origin)
  return url.toString()
}

export async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    throw new Error('当前环境不支持剪贴板复制。')
  }

  await navigator.clipboard.writeText(text)
}
