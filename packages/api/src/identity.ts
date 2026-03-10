import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { sha256Hex } from "../../contracts/src/index.ts";

export interface NodeIdentity {
  nodeId: string;
  publicKeyPem: string;
  signPayload(payload: string): string;
}

interface PersistedIdentity {
  privateKeyPem: string;
  publicKeyPem: string;
}

function loadOrCreatePair(identityPath: string): PersistedIdentity {
  if (existsSync(identityPath)) {
    return JSON.parse(readFileSync(identityPath, "utf8")) as PersistedIdentity;
  }

  const pair = generateKeyPairSync("ed25519");
  const persisted: PersistedIdentity = {
    privateKeyPem: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: pair.publicKey.export({ format: "pem", type: "spki" }).toString()
  };
  writeFileSync(identityPath, JSON.stringify(persisted, null, 2), { mode: 0o600 });
  return persisted;
}

export function loadNodeIdentity(dataDir: string): NodeIdentity {
  const identityPath = join(dataDir, "identity.json");
  const persisted = loadOrCreatePair(identityPath);
  const privateKey = createPrivateKey(persisted.privateKeyPem);
  const publicKey = createPublicKey(persisted.publicKeyPem);
  const nodeId = sha256Hex(publicKey.export({ format: "pem", type: "spki" }).toString()).slice(0, 16);

  return {
    nodeId,
    publicKeyPem: persisted.publicKeyPem,
    signPayload(payload: string): string {
      return sign(null, Buffer.from(payload), privateKey).toString("base64");
    }
  };
}

export function verifySignature(publicKeyPem: string, payload: string, signature: string): boolean {
  return verify(
    null,
    Buffer.from(payload),
    createPublicKey(publicKeyPem),
    Buffer.from(signature, "base64")
  );
}
