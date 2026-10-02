'use strict';

const crypto = require('node:crypto');
const { HttpError } = require('./errors');

const MIN_KEY_LENGTH = 24;
const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

/**
 * Express middleware: every route except `publicPaths` needs the header "Authorization: Bearer <API_KEY>".
 * Keys are compared as SHA-256 digests with timingSafeEqual, so the comparison does not leak how much of a key was right.
 * With no key configured the API is open (fine on localhost only, see the security notes in the docs).
 */
function createAuth(apiKey, publicPaths = ['/livez']) {
    if (!apiKey) {
        return (_req, _res, next) => next();
    }
    if (apiKey.length < MIN_KEY_LENGTH) {
        throw new Error(`API_KEY is too short: use at least ${MIN_KEY_LENGTH} characters (generate one with ./pn key)`);
    }
    const expected = digest(apiKey);
    return (req, _res, next) => {
        if (publicPaths.includes(req.path)) {
            return next();
        }
        const match = /^Bearer\s+(\S+)\s*$/i.exec(req.get('Authorization') || '');
        if (match && crypto.timingSafeEqual(digest(match[1]), expected)) {
            return next();
        }
        const err = new HttpError(401, 'a valid API key is required: send "Authorization: Bearer <key>"', 'UNAUTHORIZED');
        err.headers = { 'WWW-Authenticate': 'Bearer' };
        return next(err);
    };
}

module.exports = { createAuth, MIN_KEY_LENGTH };
