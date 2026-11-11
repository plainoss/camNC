export function balancedShards<T>(items: readonly T[], count: number, id: (item: T) => string, weight: (item: T) => number, reserved?: readonly number[]): T[][];
