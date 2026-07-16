export { Hub, type DispatchResult, type HubOptions, type ShellRunner } from './core/hub.js';
export { EventBus } from './core/event-bus.js';
export { ReplayBuffer, type ReplayResult } from './core/replay-buffer.js';
export { SessionRegistry, type SessionController } from './core/session-registry.js';
export {
  DeviceStore,
  PairingManager,
  RateLimiter,
  PAIRING_TOKEN_TTL_MS,
  type Device,
} from './server/auth.js';
export { isOriginAllowed, attachWs, HEARTBEAT_TIMEOUT_MS } from './server/ws.js';
export { buildApp, registerRoutes, authenticateRequest, type HttpDeps } from './server/http.js';
export { startHub, type RunningHub, type StartOptions } from './server/start.js';
export { loadOrCreateCert, type CertPair } from './server/certs.js';
export { lanAddresses, mdnsName } from './server/net.js';
export { runShellAction } from './server/shell.js';
export {
  loadConfig,
  HubConfigSchema,
  CustomActionSchema,
  PromptTemplateSchema,
  type HubConfig,
  type CustomAction,
  type PromptTemplate,
} from './config.js';
export type { Adapter, DetectResult, SpawnOpts, ManagedSession } from './adapters/types.js';
export { startDemoFleet, type DemoOptions } from './adapters/simulator.js';
export {
  ClaudeManagedAdapter,
  ClaudeManagedSession,
  CLAUDE_MODEL_DETENTS,
  CLAUDE_THINKING_DETENTS,
  type ClaudeManagedDeps,
  type QueryFn,
} from './adapters/claude/managed.js';
export { ClaudeStreamNormalizer, type SessionSink } from './adapters/claude/normalize.js';
export {
  ClaudeHooksGateway,
  PERMISSION_WAIT_MS,
  type ClaudeHookEvent,
  type HookHttpResponse,
  type HooksGatewayOptions,
} from './adapters/claude/hooks.js';
export {
  connectClaude,
  disconnectClaude,
  hookCommand,
  settingsPathFor,
  HOOK_MARKER,
  type ConnectOptions,
  type ConnectScope,
} from './adapters/claude/connect.js';
export {
  CodexAdapter,
  CodexSession,
  CODEX_EFFORT_DETENTS,
  CODEX_SANDBOX_PRESETS,
  type CodexAdapterDeps,
  type CodexRunner,
  type CodexTurnHandle,
} from './adapters/codex/exec.js';
export {
  CodexStreamNormalizer,
  CodexEventSchema,
  CodexItemSchema,
  type CodexEvent,
  type CodexItem,
} from './adapters/codex/events.js';
export {
  prettyToolDetail,
  prettyToolInput,
  diffForTool,
  buildUnifiedDiff,
  truncate,
} from './adapters/pretty.js';
export { hubSink } from './adapters/sink.js';
export { agentdeckHome, configPath, devicesPath, certDir, logsDir } from './paths.js';
