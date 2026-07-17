import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeStore, selectOutgoingCode } from "../discordE2ee/state.ts";

const CHANNEL = { code: "111111111111" };
const GUILD = { code: "222222222222" };
const PEER = { code: "333333333333" };

test("version one stores migrate without losing peer or channel codes", () => {
    const migrated = normalizeStore({
        version: 1,
        peers: { user: PEER },
        channels: { channel: CHANNEL }
    });
    assert.deepEqual(migrated, {
        version: 2,
        peers: { user: PEER },
        channels: { channel: CHANNEL },
        guilds: {}
    });
});

test("channel codes override server and peer codes", () => {
    assert.equal(selectOutgoingCode(CHANNEL, GUILD, [PEER]), CHANNEL.code);
});

test("server codes apply when a channel has no override", () => {
    assert.equal(selectOutgoingCode(undefined, GUILD, []), GUILD.code);
});

test("pausing a saved scope stops encoding without falling back", () => {
    assert.equal(selectOutgoingCode({ ...CHANNEL, paused: true }, GUILD, [PEER]), undefined);
    assert.equal(selectOutgoingCode(undefined, { ...GUILD, paused: true }, [PEER]), undefined);
});

test("DM and group recipients must have the same active code", () => {
    assert.equal(selectOutgoingCode(undefined, undefined, [PEER, PEER]), PEER.code);
    assert.equal(selectOutgoingCode(undefined, undefined, [PEER, CHANNEL]), undefined);
    assert.equal(selectOutgoingCode(undefined, undefined, [{ ...PEER, paused: true }]), undefined);
});
