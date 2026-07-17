/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface CodeRecord {
    code: string;
    paused?: boolean;
    displayName?: string;
}

export interface StoreData {
    version: 2;
    peers: Record<string, CodeRecord>;
    channels: Record<string, CodeRecord>;
    guilds: Record<string, CodeRecord>;
}

export function createEmptyStore(): StoreData {
    return { version: 2, peers: {}, channels: {}, guilds: {} };
}

export function normalizeStore(value: any): StoreData | undefined {
    if (!value?.peers || !value?.channels) return;
    if (value.version === 2 && value.guilds) return value as StoreData;
    if (value.version === 1) {
        return {
            version: 2,
            peers: value.peers,
            channels: value.channels,
            guilds: {}
        };
    }
}

export function selectOutgoingCode(
    channelRecord: CodeRecord | undefined,
    guildRecord: CodeRecord | undefined,
    peerRecords: Array<CodeRecord | undefined>
): string | undefined {
    if (channelRecord) return channelRecord.paused ? undefined : channelRecord.code;
    if (guildRecord) return guildRecord.paused ? undefined : guildRecord.code;
    if (!peerRecords.length || peerRecords.some(record => !record || record.paused)) return;
    const first = peerRecords[0]!.code;
    return peerRecords.every(record => record!.code === first) ? first : undefined;
}
