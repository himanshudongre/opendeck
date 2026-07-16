import { z } from 'zod';
import {
  ClientMsgSchema,
  ServerMsgSchema,
  type ClientMsg,
  type ClientMsgType,
  type ClientPayload,
  type ServerMsg,
  type ServerMsgType,
  type ServerPayload,
} from './messages.js';
import { PROTOCOL_VERSION } from './version.js';

export type DecodeFailureReason = 'invalid_json' | 'version_mismatch' | 'malformed';

export type DecodeResult<T> =
  { ok: true; msg: T } | { ok: false; reason: DecodeFailureReason; message: string };

/** Loose pre-parse: just enough to read the version before full validation. */
const VersionProbeSchema = z.object({ v: z.number().int() });

export function serverMsg<T extends ServerMsgType>(
  type: T,
  payload: ServerPayload<T>,
  seq: number,
  ts: number = Date.now(),
): ServerMsg {
  return { v: PROTOCOL_VERSION, seq, ts, type, payload } as ServerMsg;
}

export function clientMsg<T extends ClientMsgType>(
  type: T,
  payload: ClientPayload<T>,
  id: string,
): ClientMsg {
  return { v: PROTOCOL_VERSION, id, type, payload } as ClientMsg;
}

export function encodeServerMsg(msg: ServerMsg): string {
  return JSON.stringify(msg);
}

export function encodeClientMsg(msg: ClientMsg): string {
  return JSON.stringify(msg);
}

function decode<T>(raw: unknown, schema: z.ZodType<T>): DecodeResult<T> {
  let value: unknown = raw;
  if (typeof raw === 'string' || raw instanceof Uint8Array) {
    try {
      value = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) as unknown;
    } catch {
      return { ok: false, reason: 'invalid_json', message: 'Message is not valid JSON.' };
    }
  }

  const probe = VersionProbeSchema.safeParse(value);
  if (probe.success && probe.data.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: 'version_mismatch',
      message: `Protocol version ${probe.data.v} does not match this side's version ${PROTOCOL_VERSION}. Update the older of hub and deck — reinstalling with \`npx agentdeck@latest\` refreshes both.`,
    };
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first && first.path.length > 0 ? ` at ${first.path.join('.')}` : '';
    return {
      ok: false,
      reason: 'malformed',
      message: `Message failed validation${where}: ${first ? first.message : 'unknown issue'}.`,
    };
  }
  return { ok: true, msg: parsed.data };
}

export function decodeServerMsg(raw: unknown): DecodeResult<ServerMsg> {
  return decode(raw, ServerMsgSchema);
}

export function decodeClientMsg(raw: unknown): DecodeResult<ClientMsg> {
  return decode(raw, ClientMsgSchema);
}
