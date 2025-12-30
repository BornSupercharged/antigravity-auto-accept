const { CDPHandler } = require('../main_scripts/cdp-handler');
const vm = require('vm');
const path = require('path');
const fs = require('fs');

const logFile = path.join(__dirname, '..', 'verification_results.log');
const log = (msg) => {
    fs.appendFileSync(logFile, msg + '\n');
    console.log(msg);
};

fs.writeFileSync(logFile, '--- Bundle Verification Test Started ---\n');

try {
    const handler = new CDPHandler();
    const script = handler.getComposedScript();
    fs.writeFileSync(path.join(__dirname, 'test_bundle.js'), script);

    log('Bundle length: ' + script.length);

    const sandbox = {
        window: {},
        console: {
            log: (...args) => log('[Bundle Log] ' + args.join(' ')),
            error: (...args) => log('[Bundle Error] ' + args.join(' ')),
        },
        setTimeout: setTimeout,
        setInterval: setInterval,
        clearTimeout: clearTimeout,
        clearInterval: clearInterval,
        requestAnimationFrame: (cb) => setTimeout(cb, 16),
        document: {
            createElement: () => ({ style: {}, appendChild: () => { }, setAttribute: () => { } }),
            body: { appendChild: () => { } },
            addEventListener: () => { },
            querySelectorAll: () => [],
            querySelector: () => null,
            getElementById: () => null,
            head: { appendChild: () => { } }
        }
    };

    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;

    log('Executing bundle in sandbox...');
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);
    log('✓ Bundle execution finished without crashing');

    // Verify properties on sandbox (which is our window)
    if (typeof sandbox.__autoAcceptStart === 'function') {
        log('✓ __autoAcceptStart is defined');
    } else {
        log('✖ __autoAcceptStart is MISSING');
        throw new Error('__autoAcceptStart missing');
    }

    if (sandbox.__autoAcceptState && sandbox.__autoAcceptState.startTimes) {
        log('✓ __autoAcceptState initialized correctly');
    } else {
        log('✖ __autoAcceptState state or startTimes missing');
        throw new Error('State initialization failed');
    }

    log('--- Verification PASSED ---');
    process.exit(0);
} catch (err) {
    log('✖ Bundle Verification FAILED:');
    log(err.toString());
    if (err.stack) log(err.stack);
    process.exit(1);
}
