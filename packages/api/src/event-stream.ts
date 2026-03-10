import type { ServerResponse } from "node:http";

export interface BroadcastEvent {
  event: string;
  data: unknown;
}

export class EventStreamBroker {
  private readonly clients = new Set<ServerResponse>();

  addClient(response: ServerResponse): void {
    this.clients.add(response);
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    response.write("\n");
    response.on("close", () => {
      this.clients.delete(response);
    });
  }

  broadcast(event: BroadcastEvent): void {
    const payload = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
    for (const client of this.clients) {
      client.write(payload);
    }
  }
}
