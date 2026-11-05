import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, WebSocket } from 'ws';

export interface ScheduleChangeEvent {
  projectId: string;
  scheduleVersion: number;
  trigger: string;
  changedTasks: string[];
}

/**
 * Thin WebSocket notifier: clients subscribe to `project:<id>` and receive a
 * payload after every authoritative recalculation. All scheduling logic stays
 * in the engine/API — this only broadcasts.
 */
@WebSocketGateway({ path: '/ws' })
export class ScheduleGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('ScheduleGateway');
  private readonly clients = new Set<WebSocket>();
  private readonly subscriptions = new Map<WebSocket, Set<string>>();

  handleConnection(client: WebSocket): void {
    this.clients.add(client);
    this.subscriptions.set(client, new Set());
    client.on('message', (data: unknown) => {
      try {
        const msg = JSON.parse(String(data)) as { type?: string; projectId?: string };
        if (msg.type === 'subscribe' && msg.projectId) {
          this.subscriptions.get(client)?.add(`project:${msg.projectId}`);
          client.send(JSON.stringify({ type: 'subscribed', projectId: msg.projectId }));
        }
        if (msg.type === 'unsubscribe' && msg.projectId) {
          this.subscriptions.get(client)?.delete(`project:${msg.projectId}`);
        }
      } catch {
        /* ignore malformed frames */
      }
    });
  }

  handleDisconnect(client: WebSocket): void {
    this.clients.delete(client);
    this.subscriptions.delete(client);
  }

  emitScheduleChanged(projectId: string, event: ScheduleChangeEvent): void {
    const payload = JSON.stringify({ type: 'schedule_changed', ...event });
    for (const client of this.clients) {
      if (this.subscriptions.get(client)?.has(`project:${projectId}`)) {
        try {
          client.send(payload);
        } catch (err) {
          this.logger.warn(`Failed to notify client: ${String(err)}`);
        }
      }
    }
  }
}
