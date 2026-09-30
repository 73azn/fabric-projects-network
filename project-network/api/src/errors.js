'use strict';

/** Error raised by the API itself (bad header, bad body, ...). */
class HttpError extends Error {
    constructor(status, message, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const STATUS_BY_CODE = {
    INVALID_INPUT: 400,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    ALREADY_EXISTS: 409,
};

// gRPC status codes (UNAVAILABLE = 14, DEADLINE_EXCEEDED = 4)
const GRPC_UNAVAILABLE = 14;
const GRPC_DEADLINE_EXCEEDED = 4;

/** All the text a gateway error carries: its message plus the per-peer details. */
function errorText(err) {
    const parts = [err && err.message];
    if (err && Array.isArray(err.details)) {
        for (const d of err.details) {
            if (d && d.message) parts.push(d.message);
        }
    }
    if (err && err.cause && err.cause.message) parts.push(err.cause.message);
    return parts.filter(Boolean).join(' | ');
}

/**
 * Maps any error to { status, code, message }.
 * The chaincode throws messages like "NOT_FOUND: project PRJ-9 does not exist"; the gateway wraps them
 * in "chaincode response 500, NOT_FOUND: ..." so we look for the code token anywhere in the error text.
 */
function toHttpError(err) {
    if (err instanceof HttpError) {
        return { status: err.status, code: err.code || 'BAD_REQUEST', message: err.message };
    }
    // express.json() parse errors
    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
        return { status: 400, code: 'INVALID_INPUT', message: 'request body is not valid JSON' };
    }
    const text = errorText(err);
    const match = /\b(INVALID_INPUT|FORBIDDEN|NOT_FOUND|ALREADY_EXISTS): ([^|]*)/.exec(text);
    if (match) {
        return { status: STATUS_BY_CODE[match[1]], code: match[1], message: match[2].trim() };
    }
    // Both organizations must endorse every write: if one peer is down the gateway cannot build an endorsement plan
    if (/no combination of peers|no peer combination|failed to select a set of endorsers/i.test(text)) {
        return { status: 503, code: 'NETWORK_UNAVAILABLE', message: 'both organizations must endorse every write, but a required peer is not reachable right now' };
    }
    if (err && (err.code === GRPC_UNAVAILABLE || err.code === GRPC_DEADLINE_EXCEEDED)) {
        return { status: 503, code: 'NETWORK_UNAVAILABLE', message: 'the Fabric network is not reachable right now' };
    }
    if (/MVCC_READ_CONFLICT/.test(text)) {
        return { status: 409, code: 'CONFLICT', message: 'the project was changed by another transaction, please retry' };
    }
    return { status: 500, code: 'INTERNAL_ERROR', message: 'unexpected error while talking to the network' };
}

module.exports = { HttpError, toHttpError, errorText };
