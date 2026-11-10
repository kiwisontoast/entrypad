/**
 * Drag instrumentation for the spike. Pointer handlers are timed by wrapping
 * every listener: a capture listener on document runs before Dragology's own
 * document listener, and a bubble listener on window runs after it. The time
 * between the two is the synchronous cost of handling that event.
 */
export interface GestureSample {
  type: "pointerdown" | "pointermove";
  /** Synchronous handling time in ms. */
  ms: number;
  /** Drag status reported by Dragology when the event finished. */
  status: "idle" | "dragging";
}

export interface PerfLog {
  /** Every timed pointer event of the most recent gesture. */
  events: GestureSample[];
  /** React commit durations (ms) of the board during the gesture. */
  commits: number[];
  /** Intervals between animation frames (ms) during the gesture. */
  frames: number[];
  /** Drag status changes, in order. */
  statuses: ("idle" | "dragging")[];
  /**
   * Main-thread frames over 50ms during the gesture (Long Animation Frames
   * API, Chromium only), split into script and style/layout time.
   */
  longFrames: { duration: number; script: number; styleLayout: number }[];
}

interface LongAnimationFrameEntry extends PerformanceEntry {
  styleAndLayoutStart: number;
  scripts: { duration: number }[];
}

export function createPerf() {
  const log: PerfLog = { events: [], commits: [], frames: [], statuses: [], longFrames: [] };
  let status: "idle" | "dragging" = "idle";
  let started = 0;
  let active = false;
  let lastFrame = 0;

  const loop = (t: number) => {
    if (!active) return;
    if (lastFrame) log.frames.push(t - lastFrame);
    lastFrame = t;
    requestAnimationFrame(loop);
  };

  const begin = (type: GestureSample["type"]) => () => {
    started = performance.now();
    if (type === "pointerdown") {
      log.events = [];
      log.commits = [];
      log.frames = [];
      log.statuses = [];
      log.longFrames = [];
      active = true;
      lastFrame = 0;
      requestAnimationFrame(loop);
    }
  };
  const end = (type: GestureSample["type"]) => () => {
    if (!active) return;
    log.events.push({ type, ms: performance.now() - started, status });
  };

  document.addEventListener("pointerdown", begin("pointerdown"), { capture: true });
  document.addEventListener("pointermove", begin("pointermove"), { capture: true });
  window.addEventListener("pointerdown", end("pointerdown"));
  window.addEventListener("pointermove", end("pointermove"));
  const stop = () => {
    // Let the drop animation's frames land before stopping the frame loop.
    setTimeout(() => (active = false), 400);
  };
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);

  if (PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
    new PerformanceObserver((list) => {
      if (!active) return;
      for (const e of list.getEntries() as LongAnimationFrameEntry[]) {
        log.longFrames.push({
          duration: e.duration,
          script: e.scripts.reduce((sum, s) => sum + s.duration, 0),
          styleLayout: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
        });
      }
    }).observe({ type: "long-animation-frame", buffered: false });
  }

  return {
    log,
    onStatus(next: "idle" | "dragging") {
      if (next !== status) log.statuses.push(next);
      status = next;
    },
    get status() {
      return status;
    },
    onCommit(actualMs: number) {
      if (active) log.commits.push(actualMs);
    },
  };
}
