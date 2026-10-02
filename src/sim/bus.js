// Transient domain events. Sim functions push here; Game drains after each act/tick
// and emits them to the UI (discovery ceremony, chain-merge sound, hunter knock…).
// Never persisted: state.js strips `_events` on serialize.
export function emit(state, type, payload = {}) {
  if (!state._events) state._events = [];
  state._events.push({ type, ...payload });
}
