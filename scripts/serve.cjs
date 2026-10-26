const path = require('node:path');
const { createService } = require('../lib/server.cjs');
const service = createService({ directory: path.join(__dirname, '../.test-data'), webRoot: path.join(__dirname, '../web') });
service.start().then(() => console.log('日点 preview: http://127.0.0.1:43127')).catch(e => { console.error(e.message); process.exit(1); });
