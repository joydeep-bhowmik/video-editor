const MAX_HISTORY = 100;

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export type HistoryAction<T> =
  // Discrete edit: pushes the current present onto past, applies the updater, clears future.
  | { type: "commit"; updater: (prev: T) => T }
  // Continuous edit (drag): replaces present in place, does NOT touch past/future — used for
  // per-frame pointermove updates so a single drag gesture doesn't produce dozens of undo steps.
  | { type: "replace"; updater: (prev: T) => T }
  // Ends a continuous edit: pushes the pre-drag snapshot (captured at drag start) onto past,
  // leaving the already-updated present as-is.
  | { type: "snapshotCommit"; snapshot: T }
  | { type: "undo" }
  | { type: "redo" }
  // Hard-replaces present and wipes past/future — used when switching to a different project,
  // where the old undo stack no longer means anything.
  | { type: "reset"; present: T };

export function historyReducer<T>(state: HistoryState<T>, action: HistoryAction<T>): HistoryState<T> {
  switch (action.type) {
    case "commit": {
      const next = action.updater(state.present);
      if (next === state.present) return state;
      const past = [...state.past, state.present].slice(-MAX_HISTORY);
      return { past, present: next, future: [] };
    }
    case "replace": {
      return { ...state, present: action.updater(state.present) };
    }
    case "snapshotCommit": {
      if (action.snapshot === state.present) return state;
      const past = [...state.past, action.snapshot].slice(-MAX_HISTORY);
      return { past, present: state.present, future: [] };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return { past: [...state.past, state.present], present: next, future: state.future.slice(1) };
    }
    case "reset": {
      return { past: [], present: action.present, future: [] };
    }
  }
}

export function initialHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] };
}
