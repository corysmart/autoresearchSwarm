import { TextDecoder, TextEncoder } from "node:util";

import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { bootstrap } from "@libp2p/bootstrap";
import { identify } from "@libp2p/identify";
import { tcp } from "@libp2p/tcp";
import { createLibp2p } from "libp2p";

import { SWARM_TOPICS, type SignedEnvelope } from "../../contracts/src/index.ts";
import type { HarnessConfig } from "../../api/src/config.ts";
import type { HarnessDatabase } from "../../api/src/database.ts";
import type { EventStreamBroker } from "../../api/src/event-stream.ts";

type IngestFn = (envelope: SignedEnvelope<unknown>, source: string) => boolean;

export class ExperimentalLibp2pTransport {
  private node: Awaited<ReturnType<typeof createLibp2p>> | null = null;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private started = false;

  constructor(
    private readonly config: HarnessConfig,
    private readonly db: HarnessDatabase,
    private readonly events: EventStreamBroker,
    private readonly ingestEnvelope: IngestFn
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.db.appendAuditEvent(
      "swarm",
      "warn",
      "libp2p_experimental_enabled",
      "Experimental libp2p mode is enabled. This transport is not recommended for production use."
    );
    try {
      this.node = await createLibp2p({
        addresses: {
          listen: this.config.libp2pListenMultiaddrs
        },
        transports: [tcp()],
        streamMuxers: [yamux()],
        connectionEncrypters: [noise()],
        peerDiscovery:
          this.config.libp2pBootstrapMultiaddrs.length > 0
            ? [bootstrap({ list: this.config.libp2pBootstrapMultiaddrs })]
            : [],
        services: {
          identify: identify(),
          pubsub: gossipsub({
            allowPublishToZeroTopicPeers: true,
            emitSelf: false,
            fallbackToFloodsub: true,
            debugName: "autoresearch-experimental"
          })
        }
      });
    } catch (error) {
      this.started = false;
      throw error;
    }

    this.node.addEventListener("peer:discovery", (event: Event) => {
      const detail = (event as CustomEvent<{ id?: { toString(): string } }>).detail;
      const peerId = detail?.id?.toString() ?? "unknown";
      this.db.appendAuditEvent(
        "swarm",
        "warn",
        "libp2p_experimental_discovery",
        `Discovered peer ${peerId} over experimental libp2p`
      );
      if (detail?.id != null) {
        void this.node?.dial(detail.id as never).catch((error) => {
          this.db.appendAuditEvent("swarm", "warn", "libp2p_experimental_dial_failed", String(error), { peerId });
        });
      }
    });

    const pubsub = this.node.services.pubsub;
    pubsub.addEventListener("message", (event: Event) => {
      const detail = (event as CustomEvent<{ topic: string; data: Uint8Array }>).detail;
      if (!Object.values(SWARM_TOPICS).includes(detail.topic as (typeof SWARM_TOPICS)[keyof typeof SWARM_TOPICS])) {
        return;
      }
      try {
        const envelope = JSON.parse(this.decoder.decode(detail.data)) as SignedEnvelope<unknown>;
        this.ingestEnvelope(envelope, `libp2p:${detail.topic}`);
      } catch (error) {
        this.db.appendAuditEvent("swarm", "warn", "libp2p_experimental_decode_failed", String(error), {
          topic: detail.topic
        });
      }
    });

    for (const topic of Object.values(SWARM_TOPICS)) {
      pubsub.subscribe(topic);
    }

    this.events.broadcast({
      event: "libp2p-experimental",
      data: {
        mode: "started",
        listen: this.node.getMultiaddrs().map((address) => address.toString())
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.node) {
      this.started = false;
      return;
    }
    await this.node.stop();
    this.node = null;
    this.started = false;
  }

  async publish(envelope: SignedEnvelope<unknown>): Promise<void> {
    if (!this.node) {
      return;
    }
    await this.node.services.pubsub.publish(
      envelope.topic,
      this.encoder.encode(JSON.stringify(envelope))
    );
  }
}
