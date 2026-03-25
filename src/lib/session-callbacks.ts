/**
 * Session Callbacks
 *
 * Shared module for session-related callbacks from Socket.IO.
 * This breaks the circular dependency between AuthContext and SocketContext.
 */

// Callback for handling session kicked via socket (user logged in on another device)
let onSocketSessionKickedCallback: ((data: any) => void) | null = null;

/**
 * Set the callback to be called when a session is kicked via socket.
 * Called by AuthContext to register its handler.
 */
export function setOnSocketSessionKicked(callback: (data: any) => void) {
  onSocketSessionKickedCallback = callback;
}

/**
 * Trigger the session kicked callback.
 * Called by SocketContext when it receives a SESSION_KICKED event.
 */
export function triggerSessionKicked(data: any) {
  if (onSocketSessionKickedCallback) {
    onSocketSessionKickedCallback(data);
  }
}
