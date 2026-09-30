'use strict';

const { common } = require('@hyperledger/fabric-protos');

const PEERS = [
    { name: 'peer0.platform', org: 'platform' },
    { name: 'peer0.adminorg', org: 'admin' },
];

/** GET <operations>/healthz -> "up" if the node answers 200 {"status":"OK"}, otherwise "down". */
async function probeNode(url, timeoutMs) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        let body = null;
        try { body = await res.json(); } catch { /* not JSON */ }
        if (res.ok && (!body || body.status === 'OK')) {
            return { status: 'up', url };
        }
        return { status: 'down', url, detail: `HTTP ${res.status}` };
    } catch (err) {
        const detail = (err.cause && (err.cause.code || err.cause.message)) || err.name || err.message;
        return { status: 'down', url, detail: String(detail) };
    }
}

/** Block height of the channel as seen by one peer (qscc GetChainInfo), or null if it cannot be read. */
async function readHeight(fabric, org, channelName, timeoutMs) {
    try {
        const proposal = fabric.contract(org, 'qscc').newProposal('GetChainInfo', { arguments: [channelName] });
        const bytes = await proposal.evaluate({ deadline: Date.now() + timeoutMs });
        return Number(common.BlockchainInfo.deserializeBinary(bytes).getHeight());
    } catch {
        return null;
    }
}

/**
 * Pure decision logic (unit tested). A gap of 1 block is normal for a few seconds after a write, so it is
 * tolerated until it has lasted longer than graceMs; a gap of 2+ blocks is unhealthy immediately.
 *   lagSince: timestamp (ms) when the current 1-block gap was first seen, or null
 * Returns { reasons, inSync, heightGap, lagSince }.
 */
function assess({ nodes, heights, lagSince, nowMs, graceMs }) {
    const reasons = [];
    for (const [name, node] of Object.entries(nodes)) {
        if (node.status !== 'up') {
            reasons.push(`${name} is down${node.detail ? ` (${node.detail})` : ''}`);
        }
    }
    for (const { name } of PEERS) {
        if (nodes[name].status === 'up' && heights[name] == null) {
            reasons.push(`${name} is up but its block height could not be read`);
        }
    }

    const [a, b] = PEERS.map(({ name }) => heights[name]);
    if (a == null || b == null) {
        return { reasons, inSync: false, heightGap: null, lagSince: null };
    }

    const gap = Math.abs(a - b);
    let newLagSince = null;
    if (gap === 0) {
        return { reasons, inSync: true, heightGap: 0, lagSince: null };
    }
    if (gap === 1) {
        newLagSince = lagSince == null ? nowMs : lagSince;
        if (nowMs - newLagSince > graceMs) {
            reasons.push(`peers are out of sync: 1 block gap for more than ${Math.round(graceMs / 1000)}s`);
        }
        return { reasons, inSync: false, heightGap: 1, lagSince: newLagSince };
    }
    reasons.push(`peers are out of sync: gap of ${gap} blocks`);
    return { reasons, inSync: false, heightGap: gap, lagSince: null };
}

function createHealthChecker({ config, fabric }) {
    let lagSince = null;

    return async function check() {
        const { urls, timeoutMs, syncGraceSeconds } = config.health;

        // 1) operations service of every node, in parallel
        const entries = await Promise.all(
            Object.entries(urls).map(async ([name, url]) => [name, await probeNode(url, timeoutMs)]),
        );
        const nodes = Object.fromEntries(entries);

        // 2) block height of each peer that is up, in parallel
        const heightEntries = await Promise.all(PEERS.map(async ({ name, org }) => [
            name,
            nodes[name].status === 'up' ? await readHeight(fabric, org, config.channelName, timeoutMs * 2) : null,
        ]));
        const heights = Object.fromEntries(heightEntries);

        // 3) decide
        const nowMs = Date.now();
        const result = assess({ nodes, heights, lagSince, nowMs, graceMs: syncGraceSeconds * 1000 });
        lagSince = result.lagSince;

        const healthy = result.reasons.length === 0;
        return {
            httpStatus: healthy ? 200 : 503,
            body: {
                status: healthy ? 'healthy' : 'unhealthy',
                reasons: result.reasons,
                timestamp: new Date(nowMs).toISOString(),
                nodes,
                channel: {
                    name: config.channelName,
                    peers: Object.fromEntries(PEERS.map(({ name }) => [name, { height: heights[name] }])),
                    inSync: result.inSync,
                    heightGap: result.heightGap,
                    ...(result.lagSince != null ? { lagSeconds: Math.round((nowMs - result.lagSince) / 1000) } : {}),
                },
            },
        };
    };
}

module.exports = { createHealthChecker, assess, probeNode, PEERS };
