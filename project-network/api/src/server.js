'use strict';

const { loadConfig } = require('./config');
const { FabricConnections } = require('./fabric');
const { createHealthChecker } = require('./health');
const { createApp } = require('./app');

const config = loadConfig();
const fabric = new FabricConnections(config);
const app = createApp({ fabric, health: createHealthChecker({ config, fabric }) });

const server = app.listen(config.port, config.host, () => {
    console.log(`projects-api listening on http://${config.host}:${config.port} (channel ${config.channelName}, chaincode ${config.chaincodeName})`);
});

function shutdown() {
    console.log('shutting down');
    server.close(() => {
        fabric.close();
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
