import { PROTOCOL_VERSION } from '@agentdeck/protocol';

export function App() {
  return <main data-protocol-version={PROTOCOL_VERSION} />;
}
