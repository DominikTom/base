import type { Capability } from './core';
import { adsCapabilities } from './capabilities/ads';
import { salesCapabilities } from './capabilities/sales';
import { trafficCapabilities } from './capabilities/traffic';
import { showroomCapabilities } from './capabilities/showrooms';

// Wszystkie zdolności Data Hub — kolejność = kolejność w OpenAPI i liście narzędzi MCP.
export const CAPABILITIES: Capability[] = [
  ...salesCapabilities,
  ...trafficCapabilities,
  ...showroomCapabilities,
  ...adsCapabilities,
];

export function getCapability(name: string): Capability | undefined {
  return CAPABILITIES.find(c => c.name === name);
}
