export const INVESTIGATION_TOOL_NAMES: Set<string>;
export const INVESTIGATION_WRITE_TOOLS: Set<string>;
export function investigationAccessRefusal(
  name: string,
  options?: {
    memory?: unknown;
    scheduled?: boolean;
    sourcing?: string;
  },
): string;
