/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { get, set } from "@api/DataStore";
import { updateMessage } from "@api/MessageUpdater";
import { definePluginSettings } from "@api/Settings";
import { copyToClipboard } from "@utils/clipboard";
import { Logger } from "@utils/Logger";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import type { Channel, Guild, Message, RenderModalProps, User } from "@vencord/discord-types";
import { ChannelStore, GuildStore, Menu, Modal, openModal, showToast, TextInput, useEffect, UserStore, useState } from "@webpack/common";

import {
    codeIdentifier,
    currentRotatingCode,
    decodeMessage,
    encodeMessage,
    isEncodedMessage,
    normalizeCode,
    parseEncodedEnvelope
} from "./protocol";
import { CodeRecord, createEmptyStore, normalizeStore, selectOutgoingCode, StoreData } from "./state";

const logger = new Logger("discord e2ee");
const STORAGE_KEY_PREFIX = "discord-e2ee-v2";
const LEGACY_STORAGE_KEY_PREFIXES = ["discord-e2ee-v1", "equicord-rotating-code-overlay-v1"];
const MAX_DISCORD_MESSAGE_LENGTH = 2000;

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

let store: StoreData = createEmptyStore();
const storeListeners = new Set<() => void>();
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
        const parsed = normalizeStore(await get<StoreData>(storageKey()));
        if (parsed) return parsed;
        for (const prefix of LEGACY_STORAGE_KEY_PREFIXES) {
            const legacy = normalizeStore(await get<StoreData>(storageKey(prefix)));
            if (!legacy) continue;
            await set(storageKey(), legacy);
            return legacy;
        }
    } catch (error) {
        logger.error("Could not load your saved codes", error);
    }
    return createEmptyStore();
}

async function saveStore(): Promise<void> {
    await set(storageKey(), store);
    notifyStoreListeners();
}

function notifyStoreListeners(): void {
    for (const listener of storeListeners) listener();
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
    paused?: boolean;
    onSave(code: string): void | Promise<void>;
    onRemove?: () => void | Promise<void>;
    onTogglePaused?: () => void | Promise<void>;
}

function CodeModal({ modalProps, title, subtitle, initialValue, paused, onSave, onRemove, onTogglePaused }: CodeModalProps) {
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

    async function runAction(action: () => void | Promise<void>): Promise<void> {
        try {
            setBusy(true);
            await action();
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
            onClick: () => void runAction(onRemove),
            disabled: busy
        });
    }
    if (onTogglePaused) {
        actions.push({
            text: paused ? "Resume here" : "Pause here",
            variant: "secondary",
            onClick: () => void runAction(onTogglePaused),
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
                {initialValue && (
                    <div style={{ marginTop: 8, opacity: 0.7 }}>
                        {paused ? "Encoding is paused here. The code is still saved." : "Encoding is on here."}
                    </div>
                )}
            </div>
        </Modal>
    );
}

function managePeerCode(user: Pick<User, "id" | "username">): void {
    const existing = store.peers[user.id];
    openModal(modalProps => (
        <CodeModal
            modalProps={modalProps}
            title={`Shared code with ${user.username}`}
            subtitle="Enter the same code on both accounts. New messages in this DM will be scrambled before they are sent."
            initialValue={existing?.code ?? ""}
            paused={existing?.paused}
            onSave={async code => {
                store.peers[user.id] = { code, displayName: user.username, paused: existing?.paused ?? false };
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
            onTogglePaused={existing ? async () => {
                existing.paused = !existing.paused;
                await saveStore();
                notify(existing.paused ? `Encoding paused with ${user.username}.` : `Encoding resumed with ${user.username}.`);
            } : undefined}
        />
    ));
}

function manageChannelCode(channel: Channel, label = channel.name || "this group DM"): void {
    const existing = store.channels[channel.id];
    openModal(modalProps => (
        <CodeModal
            modalProps={modalProps}
            title={`Shared code for ${label}`}
            subtitle="Anyone using this code here can send and read scrambled messages. Pausing keeps the code saved."
            initialValue={existing?.code ?? ""}
            paused={existing?.paused}
            onSave={async code => {
                store.channels[channel.id] = { code, displayName: label, paused: existing?.paused ?? false };
                await saveStore();
                const rotating = await currentRotatingCode(code);
                notify(`Channel code saved. Current code: ${rotating}`);
                await retryPendingMessages(channel.id);
            }}
            onRemove={existing ? async () => {
                delete store.channels[channel.id];
                await saveStore();
                notify(`Code removed for ${label}.`);
            } : undefined}
            onTogglePaused={existing ? async () => {
                existing.paused = !existing.paused;
                await saveStore();
                notify(existing.paused ? `Encoding paused in ${label}.` : `Encoding resumed in ${label}.`);
            } : undefined}
        />
    ));
}

function manageGuildCode(guild: Guild): void {
    const existing = store.guilds[guild.id];
    openModal(modalProps => (
        <CodeModal
            modalProps={modalProps}
            title={`Shared code for ${guild.name}`}
            subtitle="This code applies to every text channel in the server. Pausing keeps the code saved."
            initialValue={existing?.code ?? ""}
            paused={existing?.paused}
            onSave={async code => {
                store.guilds[guild.id] = { code, displayName: guild.name, paused: existing?.paused ?? false };
                await saveStore();
                const rotating = await currentRotatingCode(code);
                notify(`Server code saved. Current code: ${rotating}`);
                await retryPendingMessages();
            }}
            onRemove={existing ? async () => {
                delete store.guilds[guild.id];
                await saveStore();
                notify(`Code removed for ${guild.name}.`);
            } : undefined}
            onTogglePaused={existing ? async () => {
                existing.paused = !existing.paused;
                await saveStore();
                notify(existing.paused ? `Encoding paused in ${guild.name}.` : `Encoding resumed in ${guild.name}.`);
            } : undefined}
        />
    ));
}

async function outgoingCode(channelId: string): Promise<string | undefined> {
    const channel = ChannelStore.getChannel(channelId) as Channel | undefined;
    const channelRecord = store.channels[channelId];
    const guildId = channel?.guild_id;
    const guildRecord = guildId ? store.guilds[guildId] : undefined;
    const recipientIds = channelRecipientIds(channel);
    const records = recipientIds.map(id => store.peers[id]);
    return selectOutgoingCode(channelRecord, guildRecord, records);
}

function allSavedCodes(): string[] {
    return [...new Set([
        ...Object.values(store.peers).map(record => record.code),
        ...Object.values(store.channels).map(record => record.code),
        ...Object.values(store.guilds).map(record => record.code)
    ])];
}

async function matchingCode(message: IncomingMessage): Promise<string | undefined> {
    const envelope = parseEncodedEnvelope(message.content);
    const candidates: string[] = [];
    const channelCode = store.channels[message.channel_id]?.code;
    if (channelCode) candidates.push(channelCode);
    const guildId = (ChannelStore.getChannel(message.channel_id) as Channel | undefined)?.guild_id;
    const guildCode = guildId ? store.guilds[guildId]?.code : undefined;
    if (guildCode) candidates.push(guildCode);
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

interface CurrentCodeScope {
    label: string;
    record?: CodeRecord;
    open(): void;
}

function currentCodeScope(channel: Channel): CurrentCodeScope {
    if (channel.guild_id) {
        const guild = GuildStore.getGuild(channel.guild_id) as Guild | undefined;
        if (guild) {
            return {
                label: guild.name,
                record: store.guilds[guild.id],
                open: () => manageGuildCode(guild)
            };
        }
    }

    const recipientIds = channelRecipientIds(channel);
    if (recipientIds.length === 1) {
        const userId = recipientIds[0];
        const user = UserStore.getUser(userId) as User | undefined;
        const username = user?.username ?? store.peers[userId]?.displayName ?? "this DM";
        return {
            label: username,
            record: store.peers[userId],
            open: () => managePeerCode({ id: userId, username })
        };
    }

    const label = channel.name || "this group DM";
    return {
        label,
        record: store.channels[channel.id],
        open: () => manageChannelCode(channel, label)
    };
}

const E2EEIcon: IconComponent = ({ height = 20, width = 20, className, paused = false }) => (
    <svg
        aria-hidden
        width={width}
        height={height}
        className={className}
        viewBox="0 0 24 24"
        fill="none"
    >
        <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="15" r="1.5" fill="currentColor" />
        {paused && <path d="M4 4 20 20" stroke="var(--status-danger)" strokeWidth="2.2" strokeLinecap="round" />}
    </svg>
);

const E2EEChatButton: ChatBarButtonFactory = ({ channel, isAnyChat }) => {
    const [, setRevision] = useState(0);

    useEffect(() => {
        const listener = () => setRevision(value => value + 1);
        storeListeners.add(listener);
        return () => void storeListeners.delete(listener);
    }, []);

    if (!isAnyChat) return null;
    const scope = currentCodeScope(channel);
    const status = !scope.record ? "Set up" : scope.record.paused ? "Paused" : "On";

    return (
        <ChatBarButton
            tooltip={`${status}: discord e2ee for ${scope.label}`}
            onClick={scope.open}
            buttonProps={{
                "aria-haspopup": "dialog",
                style: {
                    color: scope.record?.paused
                        ? "var(--status-warning)"
                        : scope.record
                            ? "var(--status-positive)"
                            : undefined
                }
            }}
        >
            <E2EEIcon paused={scope.record?.paused} />
        </ChatBarButton>
    );
};

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

const patchGuildContextMenu: NavContextMenuPatchCallback = (children, { guild }: { guild: Guild; }) => {
    if (!guild) return;
    children.push(
        <Menu.MenuItem
            id="discord-e2ee-set-guild-code"
            label={store.guilds[guild.id] ? "Manage server code" : "Set server code"}
            action={() => manageGuildCode(guild)}
        />
    );
};

const patchGroupDmContextMenu: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (!channel) return;
    const label = channel.name || "this group DM";
    children.push(
        <Menu.MenuItem
            id="discord-e2ee-set-group-code"
            label={store.channels[channel.id] ? "Manage group code" : "Set group code"}
            action={() => manageChannelCode(channel, label)}
        />
    );
};

export default definePlugin({
    name: "discord e2ee",
    description: "Scrambles text with a shared 12-digit code. E2EE means end-to-end encoding here, not encryption.",
    authors: [{ name: "itzzzryze", id: 845275368352251935n }],
    tags: ["Chat", "Servers"],
    settings,
    dependencies: ["ChatInputButtonAPI", "MessageDecorationsAPI", "MessageEventsAPI", "MessageUpdaterAPI"],
    contextMenus: {
        "user-context": patchUserContextMenu,
        "channel-context": patchChannelContextMenu,
        "guild-context": patchGuildContextMenu,
        "gdm-context": patchGroupDmContextMenu
    },
    chatBarButton: {
        icon: E2EEIcon,
        render: E2EEChatButton
    },
    toolboxActions: {
        "Make and copy a new 12-digit code": () => void generateSharedCode(),
        "Try unreadable scrambled messages again": () => void retryPendingMessages()
    },
    async start() {
        store = await loadStore();
        notifyStoreListeners();
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
