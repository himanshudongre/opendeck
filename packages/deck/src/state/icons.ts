import {
  ArrowUpRight,
  Check,
  CircleStop,
  GitBranch,
  Hammer,
  MessageCirclePlus,
  Play,
  RefreshCw,
  Search,
  Terminal,
  TestTube,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * The curated icon set for bindable keys. Layout JSON references these names,
 * so shared layouts stay valid; adding an icon here is a one-line PR.
 */
export const KEY_ICONS = {
  check: Check,
  x: X,
  zap: Zap,
  play: Play,
  stop: CircleStop,
  'arrow-up-right': ArrowUpRight,
  'message-plus': MessageCirclePlus,
  'git-branch': GitBranch,
  refresh: RefreshCw,
  search: Search,
  terminal: Terminal,
  'test-tube': TestTube,
  wrench: Wrench,
  hammer: Hammer,
} satisfies Record<string, LucideIcon>;

export type KeyIconName = keyof typeof KEY_ICONS;

export function keyIcon(name: string | undefined): LucideIcon | undefined {
  if (name === undefined) return undefined;
  return name in KEY_ICONS ? KEY_ICONS[name as KeyIconName] : undefined;
}
