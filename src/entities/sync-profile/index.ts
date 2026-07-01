export type ComparisonLevel = "Fast" | "Metadata" | "Strict";

export interface SyncProfile {
  id: string;
  name: string;
  sourceRoot: string;
  destinationRoot: string;
  defaultComparisonLevel: ComparisonLevel;
  lastSyncedAt: string | null;
}
