import { useMemo } from 'react'

type DiffBlockProps = {
  path: string
  oldText?: string
  newText: string
}

type DiffLine = {
  type: 'added' | 'removed' | 'unchanged'
  text: string
}

/**
 * Computes a simple line-by-line diff between old and new text.
 * Uses a basic longest common subsequence approach for readable diffs.
 */
const computeDiffLines = (oldText: string | undefined, newText: string): DiffLine[] => {
  if (!oldText) {
    return newText.split('\n').map((line) => ({ type: 'added', text: line }))
  }

  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  const lcs = buildLcsTable(oldLines, newLines)
  return traceLcs(oldLines, newLines, lcs)
}

const buildLcsTable = (oldLines: string[], newLines: string[]): number[][] => {
  const m = oldLines.length
  const n = newLines.length
  const table: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      table[i][j] =
        oldLines[i - 1] === newLines[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1])
    }
  }

  return table
}

/** Iterative LCS backtrack — avoids stack overflow on large files. */
const traceLcs = (oldLines: string[], newLines: string[], table: number[][]): DiffLine[] => {
  const result: DiffLine[] = []
  let i = oldLines.length
  let j = newLines.length

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'unchanged', text: oldLines[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      result.push({ type: 'added', text: newLines[j - 1] })
      j--
    } else {
      result.push({ type: 'removed', text: oldLines[i - 1] })
      i--
    }
  }

  return result.reverse()
}

const lineStyles: Record<DiffLine['type'], string> = {
  added: 'bg-green-500/10 text-green-700 dark:text-green-400',
  removed: 'bg-red-500/10 text-red-700 dark:text-red-400',
  unchanged: 'text-muted-foreground',
}

const linePrefix: Record<DiffLine['type'], string> = {
  added: '+ ',
  removed: '- ',
  unchanged: '  ',
}

export const DiffBlock = ({ path, oldText, newText }: DiffBlockProps) => {
  const lines = useMemo(() => computeDiffLines(oldText, newText), [oldText, newText])

  return (
    <div className="rounded-lg border overflow-hidden text-xs font-mono">
      <div className="bg-muted px-3 py-1.5 text-muted-foreground font-medium border-b">{path}</div>
      <div className="overflow-x-auto">
        {lines.map((line, i) => (
          <div key={i} className={`px-3 py-0.5 whitespace-pre ${lineStyles[line.type]}`}>
            {linePrefix[line.type]}
            {line.text}
          </div>
        ))}
      </div>
    </div>
  )
}
