/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { get, set } from "@api/DataStore";
import { updateMessage } from "@api/MessageUpdater";
import { definePluginSettings } from "@api/Settings";
import { copyToClipboard } from "@utils/clipboard";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, Message, RenderModalProps, User } from "@vencord/discord-types";
import { ChannelStore, Menu, Modal, openModal, showToast, TextInput, UserStore, useState } from "@webpack/common";

import {
    codeIdentifier,
    currentRotatingCode,
    decodeMessage,
    encodeMessage,
    isEncodedMessage,
    normalizeCode,
    parseEncodedEnvelope
} from "./protocol";

const logger = new Logger("discord e2ee");
const STORAGE_KEY_PREFIX = "discord-e2ee-v1";
const LEGACY_STORAGE_KEY_PREFIX = "equicord-rotating-code-overlay-v1";
const MAX_DISCORD_MESSAGE_LENGTH = 2000;

interface SharedCodeRecord {
    code: string;
    displayName?: string;
}

interface ChannelCodeRecord {
    code: string;
}

interface StoreData {
    version: 1;
    peers: Record<string, SharedCodeRecord>;
    channels: Record<string, ChannelCodeRecord>;
}

interface IncomingMessage {
    id: string;
    channel_id: string;
    content: string;
    author?: { id?: string; };
}

const settings = definePluginSettings({
    blockUnsupportedMedia: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Stop uploaded files and stickers in chats where scrambling is on. GIF picker posts and web links still work."
    },
    showRestoredIcon: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Put a small loop icon next to messages this plugin has restored."
    }
});

function emptyStore(): StoreData {
    return { version: 1, peers: {}, channels: {} };
}

let store: StoreData = emptyStore();
const processing = new Set<string>();
const decodedMessageIds = new Set<string>();
const pendingMessages = new Map<string, IncomingMessage>();

function currentUserId(): string {
    const id = UserStore.getCurrentUser()?.id;
    if (!id) throw new Error("Discord has not loaded your account yet");
    return id;
}

function storageKey(prefix = STORAGE_KEY_PREFIX): string {
    return `${prefix}:${currentUserId()}`;
}

async function loadStore(): Promise<StoreData> {
    try {
        const parsed = await get<StoreData>(storageKey());
        if (parsed?.version === 1 && parsed.peers && parsed.channels) return parsed;
        const legacy = await get<StoreData>(storageKey(LEGACY_STORAGE_KEY_PREFIX));
        if (legacy?.version === 1 && legacy.peers && legacy.channels) {
            await set(storageKey(), legacy);
            return legacy;
        }
    } catch (error) {
        logger.error("Could not load your saved codes", error);
    }
    return emptyStore();
}

async function saveStore(): Promise<void> {
    await set(storageKey(), store);
}

function notify(message: string): void {
    showToast(message);
}

function errorMessage(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
}

function channelRecipientIds(channel: Channel | undefined): string[] {
    const recipients = ((channel as any)?.recipients ?? []) as Array<string | { id?: string; }>;
    return recipients
        .map(recipient => typeof recipient === "string" ? recipient : recipient?.id)
        .filter((id): id is string => Boolean(id) && id !== UserStore.getCurrentUser()?.id);
}

interface CodeModalProps {
    modalProps: RenderModalProps;
    title: string;
    subtitle: string;
    initialValue: string;
    onSave(code: string): void | Promise<void>;
    onRemove?: () => void | Promise<void>;
}

function CodeModal({ modalProps, title, subtitle, initialValue, onSave, onRemove }: CodeModalProps) {
    const [value, setValue] = useState(initialValue);
    const [error, setError] = useState<string>();
    const [busy, setBusy] = useState(false);

    async function save(): Promise<void> {
        try {
            const code = normalizeCode(value);
            setBusy(true);
            await onSave(code);
            modalProps.onClose();
        } catch (caught) {
            setError(errorMessage(caught));
            setBusy(false);
        }
    }

    const actions: any[] = [];
    if (onRemove) {
        actions.push({
            text: "Remove code",
            variant: "danger",
            onClick: async () => {
                setBusy(true);
                await onRemove();
                modalProps.onClose();
            },
            disabled: busy
        });
    }
    actions.push(
        { text: "Cancel", variant: "secondary", onClick: modalProps.onClose, disabled: busy },
        { text: "Save", variant: "primary", onClick: save, disabled: busy || !value.trim() }
    );

    return (
        <Modal
            {...modalProps}
            title={title}
            subtitle={subtitle}
            actions={actions}
            notice={error ? { message: error, type: "critical" } : undefined}
        >
            <div style={{ padding: "8px 0" }}>
                <TextInput
                    autoFocus
                    value={value}
                    onChange={setValue}
                    placeholder="123456789012"
                    maxLength={16}
                />
                <div style={{ marginTop: 8, opacity: 0.7 }}>
                    Enter 12 digits. Spaces and hyphens are fine.
                </div>
            </div>
        </Modal>
    );
}

function managePeerCode(user: User): void {
    const existing = store.peers[user.id];
    openModal(modalProps => (
        <CodeModal
            modalProps={modalProps}
            title={`Shared code with ${user.username}`}
            subtitle="Enter the same code on both accounts. New messages in this DM will be scrambled before they are sent."
            initialValue={existing?.code ?? ""}
            onSave={async code => {
                store.peers[user.id] = { code, displayName: user.username };
                await saveStore();
                const rotating = await currentRotatingCode(code);
                notify(`Code saved for ${user.username}. Current code: ${rotating}`);
                await retryPendingMessages();
            }}
            onRemove={existing ? async () => {
                delete store.peers[user.id];
                await saveStore();
                notify(`Code removed for ${user.username}.`);
            } : undefined}
        />
    ));
}

function manageChannelCode(channel: Channel): void {
    const existing = store.channels[channel.id];
    openModal(modalProps => (
        <CodeModal
            modalProps={modalProps}
            title="Shared code for this channel"
            subtitle="Anyone using this code here can send and read scrambled messages."
            initialValue={existing?.code ?? ""}
            onSave={async code => {
                store.channels[channel.id] = { code };
                await saveStore();
                const rotating = await currentRotatingCode(code);
                notify(`Channel code saved. Current code: ${rotating}`);
                await retryPendingMessages(channel.id);
            }}
            onRemove={existing ? async () => {
                delete store.channels[channel.id];
                await saveStore();
                notify("Channel code removed. New messages will be sent normally.");
            } : undefined}
        />
    ));
}

async function outgoingCode(channelId: string): Promise<string | undefined> {
    const channelCode = store.channels[channelId]?.code;
    if (channelCode) return channelCode;

    const channel = ChannelStore.getChannel(channelId) as Channel | undefined;
    const recipientIds = channelRecipientIds(channel);
    if (!recipientIds.length) return;
    const codes = recipientIds.map(id => store.peers[id]?.code);
    if (codes.some(code => !code)) return;
    const first = codes[0]!;
    if (codes.every(code => code === first)) return first;
    return;
}

function allSavedCodes(): string[] {
    return [...new Set([
        ...Object.values(store.peers).map(record => record.code),
        ...Object.values(store.channels).map(record => record.code)
    ])];
}

async function matchingCode(message: IncomingMessage): Promise<string | undefined> {
    const envelope = parseEncodedEnvelope(message.content);
    const candidates: string[] = [];
    const channelCode = store.channels[message.channel_id]?.code;
    if (channelCode) candidates.push(channelCode);
    const senderId = message.author?.id;
    if (senderId && store.peers[senderId]?.code) candidates.push(store.peers[senderId].code);
    candidates.push(...allSavedCodes());
    for (const code of new Set(candidates)) {
        if (await codeIdentifier(code) === envelope.x) return code;
    }
    return;
}

function updateVisibleMessage(message: IncomingMessage, content: string, decoded = false): void {
    const id = `${message.channel_id}:${message.id}`;
    if (decoded) decodedMessageIds.add(id);
    updateMessage(message.channel_id, message.id, { content } as Partial<Message>);
}

async function processIncoming(message: IncomingMessage): Promise<void> {
    if (!message?.id || !message.channel_id || !isEncodedMessage(message.content)) return;
    const processingId = `${message.channel_id}:${message.id}:${message.content}`;
    if (processing.has(processingId)) return;
    processing.add(processingId);
    try {
        const code = await matchingCode(message);
        if (!code) {
            pendingMessages.set(`${message.channel_id}:${message.id}`, { ...message });
            updateVisibleMessage(message, "Scrambled message. Add the matching 12-digit code to read it.");
            return;
        }
        const plaintext = await decodeMessage(message.content, code);
        pendingMessages.delete(`${message.channel_id}:${message.id}`);
        updateVisibleMessage(message, plaintext, true);
    } catch (error) {
        logger.error("Could not restore a scrambled message", error);
        pendingMessages.set(`${message.channel_id}:${message.id}`, { ...message });
        updateVisibleMessage(message, "Could not restore this message. The code may be wrong, or the message may have changed.");
    } finally {
        processing.delete(processingId);
    }
}

async function retryPendingMessages(channelId?: string): Promise<void> {
    for (const message of [...pendingMessages.values()]) {
        if (!channelId || message.channel_id === channelId) await processIncoming(message);
    }
}

function processMessageBatch(event: any): void {
    const visit = (value: any): void => {
        if (!value) return;
        if (value.id && value.channel_id && typeof value.content === "string") {
            void processIncoming(value);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (typeof value !== "string" && typeof value[Symbol.iterator] === "function") {
            for (const item of value) visit(item);
        }
    };
    visit(event?.message ?? event?.messages);
}

async function generateSharedCode(): Promise<void> {
    const random = crypto.getRandomValues(new Uint32Array(2));
    const value = ((BigInt(random[0]) << 32n) | BigInt(random[1])) % 1_000_000_000_000n;
    const code = value.toString().padStart(12, "0");
    copyToClipboard(code);
    const rotating = await currentRotatingCode(code);
    notify(`Copied ${code}. The current code is ${rotating}.`);
}

const patchUserContextMenu: NavContextMenuPatchCallback = (children, { user }: { user: User; }) => {
    if (!user || user.id === UserStore.getCurrentUser()?.id || user.bot) return;
    children.push(
        <Menu.MenuItem
            id="discord-e2ee-set-user-code"
            label={store.peers[user.id] ? "Change or remove shared code" : "Set shared code"}
            action={() => managePeerCode(user)}
        />
    );
};

const patchChannelContextMenu: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (!channel) return;
    children.push(
        <Menu.MenuItem
            id="discord-e2ee-set-channel-code"
            label={store.channels[channel.id] ? "Change or remove channel code" : "Set channel code"}
            action={() => manageChannelCode(channel)}
        />
    );
};

export default definePlugin({
    name: "discord e2ee",
    description: "Scrambles text with a shared 12-digit code. E2EE means end-to-end encoding here, not encryption.",
    authors: [{ name: "itzzzryze", id: 845275368352251935n }],
    tags: ["Chat", "Servers"],
    settings,
    dependencies: ["MessageDecorationsAPI", "MessageEventsAPI", "MessageUpdaterAPI"],
    contextMenus: {
        "user-context": patchUserContextMenu,
        "channel-context": patchChannelContextMenu
    },
    toolboxActions: {
        "Make and copy a new 12-digit code": () => void generateSharedCode(),
        "Try unreadable scrambled messages again": () => void retryPendingMessages()
    },
    async start() {
        store = await loadStore();
    },
    onBeforeMessageSend: async (channelId, message, options, props) => {
        if (!message.content || isEncodedMessage(message.content)) return;
        const code = await outgoingCode(channelId);
        if (!code) return;
        if (settings.store.blockUnsupportedMedia && (
            (props.hasAttachments && !(options as { isGif?: boolean; }).isGif) ||
            props.hasStickers || options.stickerIds?.length
        )) {
            notify("Remove the attachment or sticker first. This plugin only scrambles text.");
            return { cancel: true };
        }
        try {
            const encoded = await encodeMessage(message.content, code);
            if (encoded.length > MAX_DISCORD_MESSAGE_LENGTH) {
                throw new Error(`The scrambled message is ${encoded.length} characters long. Split it into smaller messages.`);
            }
            message.content = encoded;
        } catch (error) {
            notify(`Could not send the message: ${errorMessage(error)}`);
            return { cancel: true };
        }
    },
    onBeforeMessageEdit: async (channelId, _messageId, message) => {
        if (!message.content || isEncodedMessage(message.content)) return;
        const code = await outgoingCode(channelId);
        if (!code) return;
        try {
            const encoded = await encodeMessage(message.content, code);
            if (encoded.length > MAX_DISCORD_MESSAGE_LENGTH) throw new Error("The scrambled edit is too long for Discord.");
            message.content = encoded;
        } catch (error) {
            notify(`Could not save the edit: ${errorMessage(error)}`);
            return { cancel: true };
        }
    },
    flux: {
        MESSAGE_CREATE: processMessageBatch,
        MESSAGE_UPDATE: processMessageBatch,
        LOAD_MESSAGES_SUCCESS: processMessageBatch,
        LOAD_MESSAGES_AROUND_SUCCESS: processMessageBatch
    },
    renderMessageDecoration({ message }: { message: Message; }) {
        if (!settings.store.showRestoredIcon || !decodedMessageIds.has(`${message.channel_id}:${message.id}`)) return null;
        return <span title="Restored by discord e2ee" style={{ marginLeft: 4 }}>↻</span>;
    }
});
