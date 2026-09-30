'use strict';

const path = require('node:path');
const dotenv = require('dotenv');

// Load api/.env (paths below are relative to the api/ folder, not to the shell's cwd)
const API_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(API_DIR, '.env'), quiet: true });

function required(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required setting ${name}. Copy .env.example to .env and fill it in.`);
    }
    return value;
}

function resolvePath(name) {
    return path.resolve(API_DIR, required(name));
}

function orgConfig(prefix) {
    return {
        mspId: required(`${prefix}_MSP_ID`),
        peerEndpoint: required(`${prefix}_PEER_ENDPOINT`),
        peerHostAlias: required(`${prefix}_PEER_HOST_ALIAS`),
        tlsCertPath: resolvePath(`${prefix}_TLS_CERT_PATH`),
        certPath: resolvePath(`${prefix}_CERT_PATH`),
        keyPath: resolvePath(`${prefix}_KEY_PATH`),
    };
}

function loadConfig() {
    return {
        host: process.env.HOST || '127.0.0.1',
        port: Number(process.env.PORT || 4000),
        channelName: required('CHANNEL_NAME'),
        chaincodeName: required('CHAINCODE_NAME'),
        orgs: {
            platform: orgConfig('PLATFORM'),
            admin: orgConfig('ADMIN'),
        },
        health: {
            urls: {
                orderer: required('ORDERER_HEALTH_URL'),
                'peer0.platform': required('PLATFORM_PEER_HEALTH_URL'),
                'peer0.adminorg': required('ADMIN_PEER_HEALTH_URL'),
            },
            timeoutMs: Number(process.env.HEALTH_TIMEOUT_MS || 2000),
            syncGraceSeconds: Number(process.env.SYNC_GRACE_SECONDS || 10),
        },
    };
}

module.exports = { loadConfig };
