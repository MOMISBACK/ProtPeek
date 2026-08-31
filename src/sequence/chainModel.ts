// SPDX-License-Identifier: MPL-2.0
export interface ChainRecord {
  authId: string;
  entityId: string;
  labelId: string;
  operatorName?: string;
}

export function uniqueChains(records: readonly ChainRecord[]): ChainRecord[] {
  const chains = new Map<string, ChainRecord>();
  for (const record of records) {
    const key = `${record.authId}\u0000${record.labelId}\u0000${record.entityId}`;
    if (!chains.has(key)) chains.set(key, record);
  }
  return [...chains.values()];
}
