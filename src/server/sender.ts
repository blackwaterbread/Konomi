import type { WebSocket } from "ws";
import type { EventSender } from "@core/types/event-sender";

/**
 * WebSocket-based EventSender implementation.
 * Broadcasts push events to all connected clients.
 */
export function createWebSocketSender(getClients: () => Set<WebSocket>): EventSender {
  return {
    send(channel: string, data: unknown): void {
      const message = JSON.stringify({ event: channel, data });
      for (const ws of getClients()) {
        if (ws.readyState === ws.OPEN) {
          ws.send(message);
        }
      }
    },
  };
}
