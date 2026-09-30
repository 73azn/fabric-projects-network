/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

/**
 * Recursively sorts object keys (arrays keep their order) so that the bytes written to the
 * ledger are identical on every peer, the same approach as fabric-samples/asset-transfer-basic.
 */
function sortKeysRecursive(value) {
    if (Array.isArray(value)) {
        return value.map(sortKeysRecursive);
    }
    if (value !== null && typeof value === 'object') {
        const sorted = {};
        for (const key of Object.keys(value).sort()) {
            sorted[key] = sortKeysRecursive(value[key]);
        }
        return sorted;
    }
    return value;
}

/** Deterministic JSON string: sorted keys, no whitespace. */
function stableStringify(value) {
    return JSON.stringify(sortKeysRecursive(value));
}

/**
 * Formats a transaction timestamp (seconds + nanos since the Unix epoch) as an ISO-8601 UTC string
 * WITHOUT using Date (chaincode must stay deterministic and free of wall-clock APIs).
 * Uses the "civil from days" algorithm (H. Hinnant).
 */
function isoFromTimestamp(seconds, nanos) {
    const secs = Number(String(seconds));
    const days = Math.floor(secs / 86400);
    const secOfDay = secs - days * 86400;

    const z = days + 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const month = mp < 10 ? mp + 3 : mp - 9;
    const year = yoe + era * 400 + (month <= 2 ? 1 : 0);

    const pad = (n, w) => String(n).padStart(w, '0');
    const hh = Math.floor(secOfDay / 3600);
    const mm = Math.floor((secOfDay % 3600) / 60);
    const ss = secOfDay % 60;
    const ms = Math.floor((Number(nanos) || 0) / 1e6);
    return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)}.${pad(ms, 3)}Z`;
}

module.exports = { sortKeysRecursive, stableStringify, isoFromTimestamp };
