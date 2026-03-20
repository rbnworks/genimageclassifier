import { useCallback, useState } from 'react'

export function useClipboard(resetAfterMs = 2000) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), resetAfterMs)
      })
    },
    [resetAfterMs],
  )

  return { copy, copied }
}
