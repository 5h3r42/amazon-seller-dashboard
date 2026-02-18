export interface SyncRunDiagnostics {
  warnings: string[];
  limitsApplied: Record<string, number | boolean>;
  truncationFlags: Record<string, boolean>;
}
