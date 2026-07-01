import type { ComparisonLevel } from "@/entities/music-file";

export type { ComparisonLevel };

export interface SyncProfile {
  id: string;
  name: string;
  sourceRoot: string;
  destinationRoot: string;
  defaultComparisonLevel: ComparisonLevel;
  lastSyncedAt: number | null;
}
