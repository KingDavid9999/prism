/**
 * Visibility-aware polling used by the live history lists.
 *
 * A plain `setInterval` keeps spending the shared API rate limit in background
 * tabs. This wrapper stops the timer while the document is hidden and does a
 * single refresh when the tab becomes visible again, then resumes the regular
 * cadence. All browser/DOM access is injectable so it can be tested in Node.
 */
export interface VisibilityPollOptions {
  intervalMs: number;
  /**
   * The refresh to run. Called once on becoming visible and on each tick.
   * Returning a number of milliseconds pauses polling for at least that long
   * before the next refresh, which is how a throttled request honors Retry-After.
   */
  refresh: () => void | number | Promise<void | number>;
  /** Returns true while the tab is in the background. */
  isHidden?: () => boolean;
  /** Subscribe to visibility changes (defaults to `document`). */
  addVisibilityListener?: (listener: () => void) => void;
  removeVisibilityListener?: (listener: () => void) => void;
}

function defaultIsHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

function defaultAddVisibilityListener(listener: () => void): void {
  document.addEventListener("visibilitychange", listener);
}

function defaultRemoveVisibilityListener(listener: () => void): void {
  document.removeEventListener("visibilitychange", listener);
}

/** Start polling; returns a disposer that clears the timer and the listener. */
export function startVisibilityPolling({
  intervalMs,
  refresh,
  isHidden = defaultIsHidden,
  addVisibilityListener = defaultAddVisibilityListener,
  removeVisibilityListener = defaultRemoveVisibilityListener,
}: VisibilityPollOptions): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let pausedUntil = 0;

  const applyPause = (pauseMs: void | number) => {
    if (typeof pauseMs === "number") pausedUntil = Date.now() + pauseMs;
  };

  // Runs one refresh unless the tab is hidden or a previous refresh asked for
  // a pause that has not elapsed yet.
  const runRefresh = () => {
    if (isHidden() || Date.now() < pausedUntil) return;
    const result = refresh();
    if (result instanceof Promise) void result.then(applyPause);
    else applyPause(result);
  };

  const stopTimer = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const startTimer = () => {
    if (timer === null && !isHidden()) {
      timer = setInterval(runRefresh, intervalMs);
    }
  };

  const onVisibilityChange = () => {
    if (isHidden()) {
      stopTimer();
      return;
    }
    // Became visible: refresh immediately so the user sees current data,
    // then carry on with the normal interval.
    runRefresh();
    startTimer();
  };

  addVisibilityListener(onVisibilityChange);
  startTimer();

  return () => {
    stopTimer();
    removeVisibilityListener(onVisibilityChange);
  };
}
