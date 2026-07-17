import assert from "node:assert/strict";
import { test } from "node:test";

import {
    codeIdentifier,
    currentRotatingCode,
    decodeMessage,
    encodeMessage,
    ENCODED_MESSAGE_PREFIX,
    normalizeCode,
    parseEncodedEnvelope,
    TRANSFORM_COUNT,
    visibleHttpLinks
} from "../discordE2ee/protocol.ts";

const CODE = "123456789012";
const NOW = 1_750_000_000_000;

test("a message survives all reversible encoding layers", async () => {
    const plaintext = "hello 👋 from discord e2ee";
    const encoded = await encodeMessage(plaintext, CODE, NOW);
    assert.ok(encoded.startsWith(ENCODED_MESSAGE_PREFIX));
    assert.equal(TRANSFORM_COUNT, 50);
    assert.equal(await decodeMessage(encoded, CODE), plaintext);
});

test("the same message receives a different encoded representation each time", async () => {
    const first = await encodeMessage("repeat", CODE, NOW);
    const second = await encodeMessage("repeat", CODE, NOW);
    assert.notEqual(first, second);
    assert.equal(await decodeMessage(first, CODE), "repeat");
    assert.equal(await decodeMessage(second, CODE), "repeat");
});

test("a different shared code cannot decode the message", async () => {
    const encoded = await encodeMessage("private group text", CODE, NOW);
    await assert.rejects(() => decodeMessage(encoded, "999999999999"), /does not match/u);
});

test("the pattern rotates between time windows and old messages remain decodable", async () => {
    const first = await encodeMessage("before", CODE, NOW);
    const second = await encodeMessage("after", CODE, NOW + 30_000);
    assert.notEqual(parseEncodedEnvelope(first).e, parseEncodedEnvelope(second).e);
    assert.notEqual(await currentRotatingCode(CODE, NOW), await currentRotatingCode(CODE, NOW + 30_000));
    assert.equal(await decodeMessage(first, CODE), "before");
    assert.equal(await decodeMessage(second, CODE), "after");
});

test("code normalization accepts spaces and hyphens but requires twelve digits", async () => {
    assert.equal(normalizeCode("1234 5678-9012"), CODE);
    assert.equal(await codeIdentifier("1234 5678-9012"), await codeIdentifier(CODE));
    assert.throws(() => normalizeCode("123456"), /12 digits/u);
    assert.throws(() => normalizeCode("12345678901x"), /12 digits/u);
});

test("tampering fails the integrity check or produces an invalid payload", async () => {
    const encoded = await encodeMessage("do not alter", CODE, NOW);
    const envelope = parseEncodedEnvelope(encoded);
    const middle = Math.floor(envelope.h.length / 2);
    envelope.h = `${envelope.h.slice(0, middle)}${envelope.h[middle] === "A" ? "B" : "A"}${envelope.h.slice(middle + 1)}`;
    const payload = Buffer.from(JSON.stringify(envelope)).toString("base64url");
    await assert.rejects(() => decodeMessage(ENCODED_MESSAGE_PREFIX + payload, CODE));
});

test("web links stay visible for Discord embeds and remain part of the restored text", async () => {
    const plaintext = "watch https://youtu.be/example and https://tenor.com/view/example";
    const encoded = await encodeMessage(plaintext, CODE, NOW);
    assert.deepEqual(visibleHttpLinks(plaintext), [
        "https://youtu.be/example",
        "https://tenor.com/view/example"
    ]);
    assert.match(encoded, /\nhttps:\/\/youtu\.be\/example\nhttps:\/\/tenor\.com\/view\/example$/u);
    assert.equal(await decodeMessage(encoded, CODE), plaintext);
});
