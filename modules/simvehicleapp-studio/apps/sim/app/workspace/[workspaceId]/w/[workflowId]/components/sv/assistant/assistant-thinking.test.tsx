/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AssistantThinking } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/assistant/assistant-thinking'

describe('assistant thinking (M17-T06)', () => {
  it('pulsing icon, Thinking with moving dots and the time waited; animations stop with reduced motion', () => {
    const html = renderToStaticMarkup(
      <AssistantThinking startedAt={Date.now() - 4_000} provider='fake' model='m' />
    )
    expect(html).toContain('data-sv-assistant="thinking"')
    expect(html).toContain('role="status"')
    expect(html).toContain('Thinking')
    expect(html).toMatch(/data-sv-assistant="elapsed">4 s</)
    expect(html.match(/animate-bounce/g)).toHaveLength(3)
    // every animated element stops with prefers-reduced-motion
    const animated = html.match(/class="[^"]*animate-[^"]*"/g) ?? []
    expect(animated.length).toBeGreaterThan(0)
    for (const c of animated) expect(c).toContain('motion-reduce:animate-none')
    expect(html).not.toContain('answering slowly')
  })

  it('after 30 s it says the model is slow and which one answers', () => {
    const html = renderToStaticMarkup(
      <AssistantThinking
        startedAt={Date.now() - 31_000}
        provider='openai-compatible'
        model='local-agent'
      />
    )
    expect(html).toContain('The model is answering slowly (openai-compatible · local-agent)')
  })
})
