import type { Locator, Page } from '@playwright/test'

/**
 * Human pace for demo recordings (`SV_DEMO=1`): a visible mouse pointer that glides to each target, clicks with a
 * short ripple, and text typed key by key instead of pasted. Tests run unchanged without it; only the video differs.
 *
 * Every `Locator` shares one prototype, so wrapping `click`, `fill` and `dragTo` there covers the spec and the
 * shared helpers alike. Any failure of the pacing itself falls back to the plain action.
 */

/** Pointer overlay: follows the real (Playwright) mouse events, pulses on mousedown. Survives navigations. */
const POINTER_SCRIPT = `(() => {
  const install = () => {
    if (document.getElementById('sv-demo-pointer')) return
    const el = document.createElement('div')
    el.id = 'sv-demo-pointer'
    el.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.6L20 11z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    Object.assign(el.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none',
      transform: 'translate(-4px,-3px)', transition: 'none' })
    const ring = document.createElement('div')
    Object.assign(ring.style, { position: 'fixed', width: '34px', height: '34px', margin: '-17px 0 0 -17px', borderRadius: '50%',
      border: '3px solid rgba(59,130,246,.85)', zIndex: '2147483646', pointerEvents: 'none', opacity: '0', transition: 'opacity .35s, transform .35s' })
    document.body.appendChild(ring)
    document.body.appendChild(el)
    const last = JSON.parse(sessionStorage.getItem('sv-demo-pointer') || '[-50,-50]')
    const at = (x, y) => { el.style.left = x + 'px'; el.style.top = y + 'px'; sessionStorage.setItem('sv-demo-pointer', JSON.stringify([x, y])) }
    at(last[0], last[1])
    addEventListener('mousemove', (e) => at(e.clientX, e.clientY), true)
    addEventListener('mousedown', (e) => {
      ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'
      ring.style.transition = 'none'; ring.style.opacity = '1'; ring.style.transform = 'scale(.6)'
      requestAnimationFrame(() => { ring.style.transition = 'opacity .45s, transform .45s'; ring.style.opacity = '0'; ring.style.transform = 'scale(1.4)' })
    }, true)
  }
  if (document.body) install(); else addEventListener('DOMContentLoaded', install)
})()`

/** Glide time per move and typing speed: roughly what a person does. */
const MOVE_STEPS = 28
const SETTLE_MS = 350
const KEY_DELAY_MS = 55

/** Moves the mouse smoothly to the centre of `target` (scrolling it into view first) and lingers a moment. */
async function glide(target: Locator) {
  const page = target.page()
  await target.scrollIntoViewIfNeeded({ timeout: 1_500 })
  const box = await target.boundingBox({ timeout: 1_500 })
  if (!box) return
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: MOVE_STEPS })
  await page.waitForTimeout(SETTLE_MS)
}

/**
 * Text that Sim's fields react to while typing (`<` opens the reference menu, `{`/newlines in code editors) is still
 * filled at once, so the recording follows exactly the path the test checks.
 */
const typeable = (value: string) => value.length > 0 && value.length <= 80 && !/[<{\n]/.test(value)

/** Only text fields are typed into: a range slider or a number spinner takes its value at once, as with a person. */
const TEXT_INPUTS = ['', 'text', 'search', 'email', 'password', 'tel', 'url']
const isTextField = (target: Locator) =>
  target.evaluate(
    (el, types) =>
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLInputElement && types.includes(el.type)) ||
      (el as HTMLElement).isContentEditable,
    TEXT_INPUTS,
    { timeout: 1_500 }
  )

/** A paced action that takes this long points at a problem: it is logged so a slow recording can be explained. */
const SLOW_MS = 15_000
async function timed<T>(what: string, target: Locator, run: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    return await run()
  } finally {
    const ms = Date.now() - start
    if (ms > SLOW_MS) console.log(`human: slow ${what} (${Math.round(ms / 1000)} s) on ${target}`)
  }
}

export async function humanize(page: Page) {
  await page.context().addInitScript(POINTER_SCRIPT)
  const proto = Object.getPrototypeOf(page.locator('body')) as Locator
  if ((proto as unknown as { svHuman?: boolean }).svHuman) return
  ;(proto as unknown as { svHuman?: boolean }).svHuman = true
  const { click, fill, dragTo } = proto

  proto.click = async function (this: Locator, ...args: Parameters<Locator['click']>) {
    return timed('click', this, async () => {
      await glide(this).catch(() => {})
      return click.apply(this, args)
    })
  }

  proto.fill = async function (this: Locator, ...args: Parameters<Locator['fill']>) {
    const [value, options] = args
    if (!typeable(value) || !(await isTextField(this).catch(() => false))) return fill.apply(this, args)
    return timed('fill', this, async () => {
      try {
        await glide(this)
        // A field a person cannot click (an overlay above it) is filled at once rather than waiting the action timeout.
        await click.call(this, { timeout: 3_000 })
        await fill.call(this, '', options)
        await this.pressSequentially(value, { delay: KEY_DELAY_MS, timeout: options?.timeout })
        await this.page().waitForTimeout(SETTLE_MS)
      } catch {
        await fill.apply(this, args)
      }
    })
  }

  proto.dragTo = async function (this: Locator, ...args: Parameters<Locator['dragTo']>) {
    await glide(this).catch(() => {})
    return dragTo.apply(this, args)
  }
}
