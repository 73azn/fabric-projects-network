'use strict';

// Amounts are SAR with at most 2 decimals (like a numeric(12,2) database column). Sums are done in whole halalas
// (1/100 SAR) so they are exact: 0.1 + 0.2 must be 0.3.
const toHalalas = (sar) => Math.round(sar * 100);
const fromHalalas = (halalas) => halalas / 100;

module.exports = { toHalalas, fromHalalas };
