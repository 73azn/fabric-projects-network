'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const grpc = require('@grpc/grpc-js');
const { connect, signers } = require('@hyperledger/fabric-gateway');

const ORG_HEADER_VALUES = { platform: 'platform', admin: 'admin' };

/** Reads the single file in a folder (Fabric MSP signcerts/keystore) or the file itself. */
function readSingleFile(p) {
    if (fs.statSync(p).isDirectory()) {
        const files = fs.readdirSync(p).filter((f) => !f.startsWith('.'));
        if (files.length === 0) throw new Error(`No file found in ${p}`);
        return fs.readFileSync(path.join(p, files[0]));
    }
    return fs.readFileSync(p);
}

/**
 * One gateway connection per organization, created lazily and reused.
 * The gRPC channel reconnects by itself when a peer restarts (short back-off so /health recovers fast).
 */
class FabricConnections {
    constructor(config) {
        this.config = config;
        this.conns = new Map();
    }

    /** Validates the X-Org header value and returns 'platform' or 'admin'. */
    static resolveOrg(headerValue) {
        if (headerValue === undefined || headerValue === '') return 'platform';
        const org = ORG_HEADER_VALUES[String(headerValue).trim().toLowerCase()];
        return org;
    }

    _open(orgKey) {
        const org = this.config.orgs[orgKey];
        const tlsRootCert = fs.readFileSync(org.tlsCertPath);
        const client = new grpc.Client(org.peerEndpoint, grpc.credentials.createSsl(tlsRootCert), {
            'grpc.ssl_target_name_override': org.peerHostAlias,
            'grpc.max_reconnect_backoff_ms': 2000,
            'grpc.initial_reconnect_backoff_ms': 500,
        });
        const credentials = readSingleFile(org.certPath);
        const privateKey = crypto.createPrivateKey(readSingleFile(org.keyPath));
        const gateway = connect({
            client,
            identity: { mspId: org.mspId, credentials },
            signer: signers.newPrivateKeySigner(privateKey),
            evaluateOptions: () => ({ deadline: Date.now() + 10_000 }),
            endorseOptions: () => ({ deadline: Date.now() + 20_000 }),
            submitOptions: () => ({ deadline: Date.now() + 10_000 }),
            commitStatusOptions: () => ({ deadline: Date.now() + 60_000 }),
        });
        return { client, gateway };
    }

    _get(orgKey) {
        if (!this.conns.has(orgKey)) {
            this.conns.set(orgKey, this._open(orgKey));
        }
        return this.conns.get(orgKey);
    }

    contract(orgKey, chaincodeName = this.config.chaincodeName) {
        return this._get(orgKey).gateway.getNetwork(this.config.channelName).getContract(chaincodeName);
    }

    close() {
        for (const { gateway, client } of this.conns.values()) {
            gateway.close();
            client.close();
        }
        this.conns.clear();
    }
}

const utf8 = new TextDecoder();
const decodeJson = (bytes) => JSON.parse(utf8.decode(bytes));

module.exports = { FabricConnections, decodeJson };
