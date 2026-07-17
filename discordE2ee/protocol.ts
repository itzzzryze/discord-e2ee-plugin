/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const ENCODED_MESSAGE_PREFIX = "EC3E:";
export const CODE_LENGTH = 12;
export const ROTATION_SECONDS = 30;
export const TRANSFORM_COUNT = 50;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HTTP_LINK_PATTERN = /\bhttps?:\/\/[^\s<>{}\[\]"']+/giu;
const ENVELOPE_DATA_PATTERN = /^[A-Za-z0-9_-]+/u;
const PROTOCOL_LABEL = "EquicordRotatingCodeOverlay/v1";
type Bytes = Uint8Array<ArrayBuffer>;

export interface EncodedEnvelope {
    v: 1;
    t: "e";
    x: string;
    e: number;
    n: string;
    d: string;
    h: string;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlToBytes(value: string): Bytes {
    if (!/^[A-Za-z0-9_-]*$/u.test(value)) throw new Error("This message contains invalid data");
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function encodeJson(value: unknown): string {
    return bytesToBase64Url(encoder.encode(JSON.stringify(value)));
}

function decodeJson<T>(value: string): T {
    return JSON.parse(decoder.decode(base64UrlToBytes(value))) as T;
}

function trimLinkEnd(value: string): string {
    let link = value.replace(/[.,!?;:]+$/u, "");
    while (link.endsWith(")")) {
        const opens = (link.match(/\(/gu) ?? []).length;
        const closes = (link.match(/\)/gu) ?? []).length;
        if (closes <= opens) break;
        link = link.slice(0, -1);
    }
    return link;
}

export function visibleHttpLinks(plaintext: string): string[] {
    const links = [...plaintext.matchAll(HTTP_LINK_PATTERN)]
        .map(match => trimLinkEnd(match[0]))
        .filter(Boolean);
    return [...new Set(links)];
}

async function digest(value: string | Bytes): Promise<Bytes> {
    const bytes: Bytes = typeof value === "string" ? encoder.encode(value) : value;
    return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export function normalizeCode(value: string): string {
    const code = value.replace(/[\s-]+/gu, "");
    if (!/^\d{12}$/u.test(code)) throw new Error("Enter 12 digits");
    return code;
}

export function currentEpoch(now = Date.now()): number {
    return Math.floor(now / (ROTATION_SECONDS * 1000));
}

async function otpForEpoch(code: string, epoch: number): Promise<string> {
    const hash = await digest(`${PROTOCOL_LABEL}|otp|${normalizeCode(code)}|${epoch}`);
    let value = 0n;
    for (const byte of hash.subarray(0, 8)) value = (value << 8n) | BigInt(byte);
    return (value % 1_000_000_000_000n).toString().padStart(CODE_LENGTH, "0");
}

export async function currentRotatingCode(code: string, now = Date.now()): Promise<string> {
    return otpForEpoch(code, currentEpoch(now));
}

export async function codeIdentifier(code: string): Promise<string> {
    const hash = await digest(`${PROTOCOL_LABEL}|id|${normalizeCode(code)}`);
    return bytesToBase64Url(hash.subarray(0, 8));
}

function rotateBitsLeft(value: number, amount: number): number {
    return ((value << amount) | (value >>> (8 - amount))) & 0xff;
}

function rotateBitsRight(value: number, amount: number): number {
    return ((value >>> amount) | (value << (8 - amount))) & 0xff;
}

function rotateArray(data: Bytes, amount: number, inverse: boolean): Bytes {
    if (data.length < 2) return data.slice() as Bytes;
    const shift = amount % data.length;
    if (!shift) return data.slice() as Bytes;
    const effective = inverse ? data.length - shift : shift;
    const output = new Uint8Array(data.length);
    output.set(data.subarray(effective));
    output.set(data.subarray(0, effective), data.length - effective);
    return output;
}

function applyPositionSwaps(data: Bytes, key: Bytes, inverse: boolean): Bytes {
    const output = data.slice() as Bytes;
    if (output.length < 2) return output;
    const swaps: Array<[number, number]> = [];
    for (let index = 1; index < 31; index += 2) {
        swaps.push([key[index - 1] % output.length, key[index] % output.length]);
    }
    if (inverse) swaps.reverse();
    for (const [first, second] of swaps) {
        const held = output[first];
        output[first] = output[second];
        output[second] = held;
    }
    return output;
}

function applyTransform(data: Bytes, key: Bytes, inverse: boolean): Bytes {
    const operation = key[0] % 7;
    const output = data.slice() as Bytes;
    switch (operation) {
        case 0: {
            const mask = key[1] || 0xa5;
            for (let index = 0; index < output.length; index++) output[index] ^= (mask + index * key[2]) & 0xff;
            return output;
        }
        case 1: {
            const amount = key[1] || 1;
            for (let index = 0; index < output.length; index++) {
                output[index] = (output[index] + (inverse ? -amount : amount) + 256) & 0xff;
            }
            return output;
        }
        case 2: {
            const amount = key[1] % 7 + 1;
            for (let index = 0; index < output.length; index++) {
                output[index] = inverse ? rotateBitsRight(output[index], amount) : rotateBitsLeft(output[index], amount);
            }
            return output;
        }
        case 3:
            output.reverse();
            return output;
        case 4:
            return rotateArray(output, (key[1] << 8) | key[2], inverse);
        case 5:
            for (let index = 0; index + 1 < output.length; index += 2) {
                const held = output[index];
                output[index] = output[index + 1];
                output[index + 1] = held;
            }
            return output;
        default:
            return applyPositionSwaps(output, key, inverse);
    }
}

async function layerKeys(code: string, epoch: number, nonce: string): Promise<Bytes[]> {
    const otp = await otpForEpoch(code, epoch);
    return Promise.all(Array.from({ length: TRANSFORM_COUNT }, (_, layer) =>
        digest(`${PROTOCOL_LABEL}|pattern|${otp}|${epoch}|${nonce}|${layer}`)
    ));
}

function makePaddedPayload(plaintext: string): Bytes {
    const content = encoder.encode(plaintext);
    const paddingLength = crypto.getRandomValues(new Uint8Array(1))[0] % 24;
    const payload = new Uint8Array(4 + content.length + paddingLength);
    new DataView(payload.buffer).setUint32(0, content.length, false);
    payload.set(content, 4);
    if (paddingLength) crypto.getRandomValues(payload.subarray(4 + content.length));
    return payload;
}

function readPaddedPayload(payload: Bytes): string {
    if (payload.length < 4) throw new Error("This message is missing data");
    const contentLength = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, false);
    if (contentLength > payload.length - 4) throw new Error("This message has the wrong data length");
    return decoder.decode(payload.subarray(4, 4 + contentLength));
}

async function integrityTag(code: string, epoch: number, nonce: string, plaintext: string): Promise<string> {
    const hash = await digest(`${PROTOCOL_LABEL}|check|${normalizeCode(code)}|${epoch}|${nonce}|${plaintext}`);
    return bytesToBase64Url(hash.subarray(0, 12));
}

export async function encodeMessage(plaintext: string, code: string, now = Date.now()): Promise<string> {
    const normalized = normalizeCode(code);
    const epoch = currentEpoch(now);
    const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
    const nonce = bytesToBase64Url(nonceBytes);
    const keys = await layerKeys(normalized, epoch, nonce);
    let transformed = makePaddedPayload(plaintext);
    for (const key of keys) transformed = applyTransform(transformed, key, false);
    const envelope: EncodedEnvelope = {
        v: 1,
        t: "e",
        x: await codeIdentifier(normalized),
        e: epoch,
        n: nonce,
        d: bytesToBase64Url(transformed),
        h: await integrityTag(normalized, epoch, nonce, plaintext)
    };
    const encoded = ENCODED_MESSAGE_PREFIX + encodeJson(envelope);
    const visibleLinks = visibleHttpLinks(plaintext);
    return visibleLinks.length ? `${encoded}\n${visibleLinks.join("\n")}` : encoded;
}

export function parseEncodedEnvelope(encoded: string): EncodedEnvelope {
    if (!encoded.startsWith(ENCODED_MESSAGE_PREFIX)) throw new Error("This is not a scrambled message");
    const envelopeData = encoded.slice(ENCODED_MESSAGE_PREFIX.length).match(ENVELOPE_DATA_PATTERN)?.[0];
    if (!envelopeData) throw new Error("This scrambled message is incomplete");
    const value = decodeJson<EncodedEnvelope>(envelopeData);
    if (
        value.v !== 1 || value.t !== "e" || typeof value.x !== "string" ||
        !Number.isSafeInteger(value.e) || typeof value.n !== "string" ||
        typeof value.d !== "string" || typeof value.h !== "string"
    ) throw new Error("This scrambled message is incomplete");
    return value;
}

export async function decodeMessage(encoded: string, code: string): Promise<string> {
    const normalized = normalizeCode(code);
    const envelope = parseEncodedEnvelope(encoded);
    if (envelope.x !== await codeIdentifier(normalized)) throw new Error("This code does not match the message");
    const keys = await layerKeys(normalized, envelope.e, envelope.n);
    let transformed = base64UrlToBytes(envelope.d);
    for (let index = keys.length - 1; index >= 0; index--) transformed = applyTransform(transformed, keys[index], true);
    const plaintext = readPaddedPayload(transformed);
    if (envelope.h !== await integrityTag(normalized, envelope.e, envelope.n, plaintext)) {
        throw new Error("This message has changed since it was sent");
    }
    return plaintext;
}

export function isEncodedMessage(content: string): boolean {
    return content.startsWith(ENCODED_MESSAGE_PREFIX);
}
