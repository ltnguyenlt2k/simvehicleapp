'use client'

import { useEffect } from 'react'
import { svPhraseVi } from '@/lib/sv/i18n/phrase'

/**
 * Subtrees left as they are: what the user types or wrote (inputs, editors, code), and the canvas, whose block texts
 * are translated at the source (block registry, summaries, edge labels) while block names stay the user's.
 */
const SKIP = [
  'input',
  'textarea',
  'script',
  'style',
  'code',
  'pre',
  'kbd',
  '[contenteditable="true"]',
  '.monaco-editor',
  '.cm-editor',
  '.react-flow__viewport',
  '[data-sv-no-translate]',
].join(',')
/** What users write is skipped, but the labels of their inputs (placeholder, title…) are translated. */
const SKIP_ATTRIBUTES = [
  '[contenteditable="true"]',
  '.react-flow__viewport',
  '[data-sv-no-translate]',
].join(',')
const ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt'] as const

function skipped(node: Node): boolean {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return !el || el.closest(SKIP) !== null
}

function translateText(node: Text) {
  const value = node.nodeValue
  if (!value || skipped(node)) return
  const vi = svPhraseVi(value)
  if (vi !== null && vi !== value) node.nodeValue = vi
}

function translateAttributes(el: Element) {
  if (el.closest(SKIP_ATTRIBUTES)) return
  for (const name of ATTRIBUTES) {
    const value = el.getAttribute(name)
    if (!value) continue
    const vi = svPhraseVi(value)
    if (vi !== null && vi !== value) el.setAttribute(name, vi)
  }
}

function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root as Text)
  if (root.nodeType !== Node.ELEMENT_NODE) return
  translateAttributes(root as Element)
  if (skipped(root)) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeType === Node.ELEMENT_NODE && (n as Element).matches(SKIP)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) translateText(n as Text)
    else translateAttributes(n as Element)
  }
  for (const input of (root as Element).querySelectorAll('input,textarea'))
    translateAttributes(input)
}

/**
 * Vietnamese for the English UI of the studio that is not keyed (Sim chrome, existing vehicle surfaces — ADR-0072
 * Notes 2026-11-01). Mounted only in the `vi` locale; a MutationObserver translates what React renders before the
 * browser paints it, so English never shows. Unknown text is left as it is.
 */
export function SvDomTranslator() {
  useEffect(() => {
    // The server-rendered page is translated once hydration is over (changing it earlier makes React re-render it);
    // what React renders in the browser is translated by the observer as it appears.
    const firstPass = () => {
      translateTree(document.body)
      document.title = svPhraseVi(document.title) ?? document.title
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const onLoad = () => {
      timer = setTimeout(firstPass, 50)
    }
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad, { once: true })
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') translateText(r.target as Text)
        else if (r.type === 'attributes') translateAttributes(r.target as Element)
        else for (const n of r.addedNodes) translateTree(n)
      }
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTES],
    })
    return () => {
      observer.disconnect()
      window.removeEventListener('load', onLoad)
      if (timer) clearTimeout(timer)
    }
  }, [])
  return null
}
