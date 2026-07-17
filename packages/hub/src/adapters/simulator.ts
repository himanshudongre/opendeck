import { SimulatorFleet, demoFleet, type SimHost } from '@agentdeck/simulator';
import type { Hub } from '../core/hub.js';
import { logger } from '../logger.js';

export interface DemoOptions {
  seed?: number;
  speed?: number;
}

/**
 * Bridges the scripted fleet onto the hub: `agent-deck --demo`. The simulator
 * knows nothing about the hub; this glue is the SimHost implementation.
 */
export function startDemoFleet(hub: Hub, options: DemoOptions = {}): SimulatorFleet {
  const host: SimHost = {
    upsert: (session, controls) => {
      hub.upsertSession(session, {
        prompt: (text) => {
          controls.prompt(text);
        },
        interrupt: () => {
          controls.interrupt();
        },
        setEffort: (payload) => controls.setEffort(payload.axis, payload.value),
        kill: () => {
          controls.kill();
        },
      });
    },
    setStatus: (sessionId, status, tool) => {
      hub.setStatus(sessionId, status, tool);
    },
    transcript: (sessionId, role, text, done) => {
      hub.transcript(sessionId, role, text, done);
    },
    tool: (sessionId, phase, tool, ok) => {
      hub.toolEvent(sessionId, phase, tool, ok);
    },
    stats: (sessionId, stats) => {
      hub.updateStats(sessionId, stats);
    },
    notice: (sessionId, level, text) => {
      hub.notice(sessionId, level, text);
    },
    requestPermission: (sessionId, tool) => hub.requestPermission(sessionId, tool).resolution,
    remove: (sessionId) => {
      hub.removeSession(sessionId);
    },
  };

  const fleet = new SimulatorFleet(host, demoFleet(), {
    hubId: hub.hubId,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    ...(options.speed === undefined ? {} : { speed: options.speed }),
  });
  fleet.start();
  logger().info({ seed: options.seed, speed: options.speed }, 'demo fleet started');
  return fleet;
}
