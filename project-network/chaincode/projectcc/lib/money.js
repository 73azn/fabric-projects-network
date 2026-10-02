/*
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

/**
 * Money is SAR with at most 2 decimals, like a numeric(12,2) database column.
 * All arithmetic is done in whole halalas (1/100 SAR) so sums and comparisons are exact
 * (floating point would make 0.1 + 0.2 differ from 0.3).
 */

// numeric(12,2): at most 10 digits before the decimal point
const MAX_AMOUNT = 9999999999.99;

/** True for a finite number with at most 2 decimals, e.g. 100, 100.5, 0.01 (not 0.001, not "100"). */
function hasAtMostTwoDecimals(value) {
    return typeof value === 'number' && Number.isFinite(value) && Number(value.toFixed(2)) === value;
}

function toHalalas(sar) {
    return Math.round(sar * 100);
}

function fromHalalas(halalas) {
    return halalas / 100;
}

/** Sum of the "amount" of the given items, as exact SAR. */
function sumAmounts(items) {
    return fromHalalas(items.reduce((sum, item) => sum + toHalalas(item.amount), 0));
}

/** For error messages: 300000 -> "300000", 100.5 -> "100.50" */
function formatSar(sar) {
    const text = sar.toFixed(2);
    return text.endsWith('.00') ? text.slice(0, -3) : text;
}

module.exports = { MAX_AMOUNT, hasAtMostTwoDecimals, toHalalas, fromHalalas, sumAmounts, formatSar };
