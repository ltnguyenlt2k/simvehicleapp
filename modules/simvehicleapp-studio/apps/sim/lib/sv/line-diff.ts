/**
 * Line diff for the generated-files viewer (M07-T19): the common prefix/suffix are kept, the middle
 * is aligned on its longest common subsequence. Above `maxCells` the middle is shown as removed then
 * added (a whole-file rewrite), so a huge file never blocks the browser.
 */

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string }

export function lineDiff(before: string, after: string, maxCells = 4_000_000): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const head: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }))
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ kind: 'same', text }))
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const n = midA.length
  const m = midB.length
  if (n * m > maxCells) {
    return [
      ...head,
      ...midA.map((text) => ({ kind: 'del' as const, text })),
      ...midB.map((text) => ({ kind: 'add' as const, text })),
      ...tail,
    ]
  }
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const mid: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      mid.push({ kind: 'same', text: midA[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      mid.push({ kind: 'del', text: midA[i++] })
    } else {
      mid.push({ kind: 'add', text: midB[j++] })
    }
  }
  while (i < n) mid.push({ kind: 'del', text: midA[i++] })
  while (j < m) mid.push({ kind: 'add', text: midB[j++] })
  return [...head, ...mid, ...tail]
}
