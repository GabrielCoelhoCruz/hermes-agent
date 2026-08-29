import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('native input notification follows the focused session', () => {
  const desktopWindow = window as unknown as { hermesDesktop?: Window['hermesDesktop'] }
  const initialHermesDesktop = desktopWindow.hermesDesktop

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    if (initialHermesDesktop) {
      desktopWindow.hermesDesktop = initialHermesDesktop
    } else {
      delete desktopWindow.hermesDesktop
    }

    vi.resetModules()
  })

  it('fires for the hidden primary session while another session tile is focused', async () => {
    const tree = await import('@/components/pane-shell/tree/store')
    const model = await import('@/components/pane-shell/tree/model')
    const { registry } = await import('@/contrib/registry')
    const session = await import('./session')
    const states = await import('./session-states')
    const notifications = await import('./native-notifications')
    const baseline = await import('./notify-baseline')

    for (const id of ['workspace', 'session-tile:tiled']) {
      registry.register({
        area: 'panes',
        data: id === 'workspace' ? { placement: 'main', uncloseable: true } : { placement: 'main' },
        id,
        render: () => null,
        title: id
      })
    }

    tree.declareDefaultTree(
      model.split('row', [
        model.group(['workspace'], { active: 'workspace', id: 'grp-main' }),
        model.group(['session-tile:tiled'], { active: 'session-tile:tiled', id: 'grp-tile' })
      ])
    )

    session.$selectedStoredSessionId.set('primary')
    session.setActiveSessionId('rt-primary')
    states.$sessionTiles.set([{ runtimeId: 'rt-tiled', storedSessionId: 'tiled' }])
    tree.noteActiveTreeGroup('grp-tile')

    expect(states.$focusedRuntimeId.get()).toBe('rt-tiled')
    expect(session.$activeSessionId.get()).toBe('rt-primary')

    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true })
    const notify = vi.fn().mockResolvedValue(true)
    desktopWindow.hermesDesktop = { notify } as unknown as Window['hermesDesktop']
    notifications.setNativeNotifyEnabled(true)
    notifications.setNativeNotifyKind('input', true)
    baseline.__resetNativeNotifyBaselineForTests()

    notifications.dispatchNativeNotification({
      kind: 'input',
      sessionId: 'rt-primary',
      title: 'Hermes needs your input'
    })

    expect(notify).toHaveBeenCalledTimes(1)
  })
})
