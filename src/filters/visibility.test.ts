import { pauseWhileHidden } from './visibility';

/** An IntersectionObserver the test drives. */
function fakeObserver() {
  const state = {
    callback: undefined as IntersectionObserverCallback | undefined,
    observed: [] as Element[],
    disconnected: false,
  };
  const observe = (callback: IntersectionObserverCallback) => {
    state.callback = callback;
    return {
      observe: (element: Element) => state.observed.push(element),
      disconnect: () => {
        state.disconnected = true;
      },
    } as unknown as IntersectionObserver;
  };
  const report = (target: Element, isIntersecting: boolean) =>
    state.callback?.([{ target, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
  return { state, observe, report };
}

describe('pauseWhileHidden', () => {
  it("disables a control's clients while it is out of view, and enables them as it shows", () => {
    const { state, observe, report } = fakeObserver();
    const shown = document.createElement('div');
    const closed = document.createElement('div');
    document.body.appendChild(shown);
    const a = [{ enabled: true }, { enabled: true }];
    const b = [{ enabled: true }];
    pauseWhileHidden(
      [
        { element: shown, clients: a },
        { element: closed, clients: b },
      ],
      observe
    );
    expect(state.observed).toEqual([shown, closed]);

    report(shown, true);
    report(closed, false);
    expect(a.map((c) => c.enabled)).toEqual([true, true]);
    expect(b[0].enabled).toBe(false);

    // The popover opens: its control is put in the page.
    document.body.appendChild(closed);
    report(closed, true);
    expect(b[0].enabled).toBe(true);
    report(shown, false);
    expect(a.map((c) => c.enabled)).toEqual([false, false]);
  });

  it('counts a detached element as out of view, whatever the observer says', () => {
    const { observe, report } = fakeObserver();
    const detached = document.createElement('div');
    const clients = [{ enabled: true }];
    pauseWhileHidden([{ element: detached, clients }], observe);
    report(detached, true);
    expect(clients[0].enabled).toBe(false);
  });

  it('only stops watching when undone: an enabled client would query a coordinator going away', () => {
    const { state, observe, report } = fakeObserver();
    const element = document.createElement('div');
    const clients = [{ enabled: true }];
    const undo = pauseWhileHidden([{ element, clients }], observe);
    report(element, false);
    undo();
    expect(state.disconnected).toBe(true);
    expect(clients[0].enabled).toBe(false);
  });
});
