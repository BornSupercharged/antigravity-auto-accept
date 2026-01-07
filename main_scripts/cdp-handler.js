const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[CDP]';

class CDPHandler {
    constructor(startPort = 9000, endPort = 9030, logger = console.log) {
        this.startPort = startPort;
        this.endPort = endPort;
        this.logger = logger;
        this.connections = new Map();
        this.messageId = 1;
        this.pendingMessages = new Map();
        this.isEnabled = false;
        this.logFilePath = null;
    }

    setLogFile(filePath) {
        this.logFilePath = filePath;
        if (filePath) {
            fs.writeFileSync(filePath, `[${new Date().toISOString()}] CDP Log Initialized\n`);
        }
    }

    log(...args) {
        const msg = `${LOG_PREFIX} ${args.join(' ')}`;
        if (this.logger) this.logger(msg);
        // Also write to log file for debugging
        if (this.logFilePath) {
            try {
                fs.appendFileSync(this.logFilePath, `[${new Date().toISOString()}] ${msg}\n`);
            } catch (e) { /* ignore file write errors */ }
        }
    }

    async isCDPAvailable() {
        const instances = await this.scanForInstances();
        return instances.length > 0;
    }

    async scanForInstances() {
        const instances = [];
        // Prioritize 9222 (standard) and then scan 9000-9030
        const portsToScan = [9222];
        for (let p = this.startPort; p <= this.endPort; p++) {
            if (p !== 9222) portsToScan.push(p);
        }

        for (const port of portsToScan) {
            try {
                const pages = await this.getPages(port);
                if (pages.length > 0) instances.push({ port, pages });
            } catch (e) { }
        }
        return instances;
    }

    getPages(port) {
        return new Promise((resolve, reject) => {
            const req = http.get({ hostname: '127.0.0.1', port, path: '/json/list', timeout: 2000 }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const allPages = JSON.parse(data);
                        this.log(`Raw CDP targets: ${allPages.length} found`);

                        // Filter to only include targets with webSocketDebuggerUrl
                        const validPages = allPages.filter(p => p.webSocketDebuggerUrl);

                        // Log each target for debugging
                        validPages.forEach(p => {
                            this.log(`  Target: type=${p.type}, id=${p.id}, title="${(p.title || '').substring(0, 50)}"`);
                        });

                        // Sort to prioritize: 1) main page, 2) iframes, 3) workers
                        // Main page is where the native Accept buttons live
                        validPages.sort((a, b) => {
                            const priority = { 'page': 0, 'iframe': 1, 'other': 2, 'worker': 3 };
                            const aPriority = priority[a.type] ?? 2;
                            const bPriority = priority[b.type] ?? 2;
                            return aPriority - bPriority;
                        });

                        this.log(`Sorted ${validPages.length} pages for injection (main page first)`);
                        resolve(validPages);
                    }
                    catch (e) {
                        this.log(`Error parsing CDP response: ${e.message}`);
                        reject(e);
                    }
                });
            });
            req.on('error', (e) => {
                this.log(`CDP request error on port ${port}: ${e.message}`);
                reject(e);
            });
            req.on('timeout', () => {
                this.log(`CDP request timeout on port ${port}`);
                req.destroy();
                reject(new Error('timeout'));
            });
        });
    }

    async start(config) {
        this.isEnabled = true;
        this.config = config; // Store config for later use
        const instances = await this.scanForInstances();

        this.log(`Found ${instances.length} CDP instance(s)`);
        for (const instance of instances) {
            this.log(`Instance on port ${instance.port}: ${instance.pages.length} page(s)`);
            for (const page of instance.pages) {
                // Skip workers - they don't have a DOM
                if (page.type === 'worker') {
                    this.log(`  Skipping worker: ${page.id} (no DOM)`);
                    continue;
                }

                this.log(`  Page: ${page.id} - ${page.title || 'untitled'} - ${page.url || 'no url'}`);
                if (!this.connections.has(page.id)) {
                    await this.connectToPage(page);
                }
                if (this.connections.has(page.id)) {
                    await this.injectAndStart(page.id, config);
                }
            }
        }

        // Query and log diagnostic info from the main page
        await this.logDiagnostics();

        // Start keyboard shortcut polling loop as a fallback
        this.startKeyboardShortcutLoop(config.pollInterval || 2000);
    }

    startKeyboardShortcutLoop(interval) {
        // Clear any existing loop
        if (this.keyboardLoopInterval) {
            clearInterval(this.keyboardLoopInterval);
        }

        this.log(`Starting keyboard shortcut loop (every ${interval}ms)...`);

        // Poll every interval and try to send the Accept shortcut
        this.keyboardLoopInterval = setInterval(async () => {
            if (!this.isEnabled) {
                clearInterval(this.keyboardLoopInterval);
                return;
            }

            // Safety Check: Verify we are targeting Antigravity (or at least checking title)
            const isSafe = await this.verifyTargetIsAntigravity();
            if (!isSafe) {
                return;
            }

            // Try sending the Alt+G shortcut
            try {
                await this.sendAcceptShortcut();
            } catch (e) {
                // Ignore errors silently
            }
        }, interval);
    }

    // Check if the connected page is likely Antigravity
    async verifyTargetIsAntigravity() {
        const mainPageId = Array.from(this.connections.keys())[0];
        if (!mainPageId) return false;

        try {
            const result = await this.sendCommand(mainPageId, 'Runtime.evaluate', {
                expression: 'document.title'
            });

            const title = result.result?.value || '';

            // If legitimate Antigravity, it usually has "Antigravity" in the title
            // If it's pure VS Code, it says "Visual Studio Code"
            // We want to avoid sending keys to pure VS Code IF we can distinguish them.
            if (title.includes('Visual Studio Code') && !title.includes('Antigravity') && !title.includes('BornSupercharged')) {
                if (!this._loggedMismatch) {
                    this.log(`[WARNING] Skipping input: Target appears to be VS Code ("${title}"), not Antigravity.`);
                    this._loggedMismatch = true;
                }
                return false;
            }

            return true;
        } catch (e) {
            return false;
        }
    }

    async logDiagnostics() {
        // Only log diagnostics every 10 seconds to avoid spam
        const now = Date.now();
        if (this.lastDiagnosticTime && (now - this.lastDiagnosticTime) < 10000) {
            return;
        }
        this.lastDiagnosticTime = now;

        for (const [pageId] of this.connections) {
            try {
                const result = await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: `(function(){
                        if(typeof window === 'undefined') return JSON.stringify({error: 'no window'});
                        
                        // Recursively get all elements including those in Shadow DOMs
                        function getAllElements(root, depth = 0) {
                            const elements = [];
                            if (depth > 10) return elements; // Prevent infinite recursion
                            
                            const children = root.querySelectorAll ? root.querySelectorAll('*') : [];
                            children.forEach(el => {
                                elements.push(el);
                                // Also search inside shadow roots
                                if (el.shadowRoot) {
                                    elements.push(...getAllElements(el.shadowRoot, depth + 1));
                                }
                            });
                            return elements;
                        }
                        
                        const allElements = getAllElements(document);
                        const buttons = allElements.filter(el => el.tagName === 'BUTTON');
                        const clickables = allElements.filter(el => 
                            el.tagName === 'BUTTON' || 
                            el.tagName === 'A' ||
                            el.getAttribute('role') === 'button' ||
                            el.onclick ||
                            (el.className && (el.className.includes('button') || el.className.includes('btn')))
                        );
                        
                        // Find any element with Accept-like text
                        const acceptPatterns = ['accept', 'run command', 'allow', 'approve', 'confirm', 'reject'];
                        const acceptElements = [];
                        
                        allElements.forEach(el => {
                            const text = (el.textContent || '').toLowerCase().trim();
                            if (text.length > 0 && text.length < 100 && acceptPatterns.some(p => text.includes(p))) {
                                const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
                                acceptElements.push({
                                    tag: el.tagName,
                                    text: text.substring(0, 50),
                                    classes: el.className ? String(el.className).substring(0, 80) : '',
                                    id: el.id || '',
                                    visible: rect && rect.width > 0 && rect.height > 0,
                                    inShadow: el.getRootNode() !== document
                                });
                            }
                        });
                        
                        // Count shadow roots
                        const shadowRoots = allElements.filter(el => el.shadowRoot).length;
                        
                        return JSON.stringify({
                            totalElements: allElements.length,
                            buttons: buttons.length,
                            clickables: clickables.length,
                            shadowRoots: shadowRoots,
                            acceptElements: acceptElements.slice(0, 15),
                            url: window.location.href.substring(0, 80),
                            state: window.__autoAcceptState ? {
                                isRunning: window.__autoAcceptState.isRunning,
                                mode: window.__autoAcceptState.currentMode
                            } : null
                        });
                    })()`,
                    returnByValue: true
                });

                if (result.result?.value) {
                    const diag = JSON.parse(result.result.value);
                    this.log(`[DIAG] Page ${pageId.substring(0, 8)}... URL: ${diag.url || 'unknown'}`);
                    this.log(`[DIAG]   Elements: ${diag.totalElements}, Buttons: ${diag.buttons}, Clickables: ${diag.clickables}, ShadowRoots: ${diag.shadowRoots || 0}`);
                    if (diag.state) {
                        this.log(`[DIAG]   Script state: isRunning=${diag.state.isRunning}, mode=${diag.state.mode}`);
                    }
                    if (diag.acceptElements && diag.acceptElements.length > 0) {
                        this.log(`[DIAG]   Found ${diag.acceptElements.length} accept-like elements:`);
                        diag.acceptElements.forEach((el, i) => {
                            this.log(`[DIAG]     ${i + 1}. <${el.tag}> "${el.text}" shadow=${el.inShadow} visible=${el.visible}`);
                        });
                    }
                    if (diag.error) {
                        this.log(`[DIAG]   Error: ${diag.error}`);
                    }
                }
            } catch (e) {
                // Ignore errors from pages that don't have the script
            }
        }
    }

    async stop() {
        this.isEnabled = false;

        // Clear keyboard shortcut loop
        if (this.keyboardLoopInterval) {
            clearInterval(this.keyboardLoopInterval);
            this.keyboardLoopInterval = null;
        }

        const stopPromises = [];
        for (const [pageId] of this.connections) {
            stopPromises.push(
                this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: 'if(typeof window !== "undefined" && window.__autoAcceptStop) window.__autoAcceptStop()'
                }).catch(() => { })
            );
        }
        this.disconnectAll();
        Promise.allSettled(stopPromises);
    }

    // Send Alt+G keyboard shortcut to trigger Antigravity's native Accept
    async sendAcceptShortcut() {
        this.log('Sending Alt+G Accept shortcut...');

        // Get the main page connection (first one, which should be the main window)
        const mainPageId = Array.from(this.connections.keys())[0];
        if (!mainPageId) {
            this.log('No page connection for keyboard shortcut');
            return false;
        }

        try {
            // Send Alt+G using CDP Input.dispatchKeyEvent
            // First, press Alt (modifiers = 1 for Alt)
            await this.sendCommand(mainPageId, 'Input.dispatchKeyEvent', {
                type: 'keyDown',
                modifiers: 1, // Alt
                key: 'Alt',
                code: 'AltLeft',
                windowsVirtualKeyCode: 18
            });

            // Then press G while Alt is held
            await this.sendCommand(mainPageId, 'Input.dispatchKeyEvent', {
                type: 'keyDown',
                modifiers: 1, // Alt
                key: 'g',
                code: 'KeyG',
                windowsVirtualKeyCode: 71
            });

            // Release G
            await this.sendCommand(mainPageId, 'Input.dispatchKeyEvent', {
                type: 'keyUp',
                modifiers: 1,
                key: 'g',
                code: 'KeyG',
                windowsVirtualKeyCode: 71
            });

            // Release Alt
            await this.sendCommand(mainPageId, 'Input.dispatchKeyEvent', {
                type: 'keyUp',
                modifiers: 0,
                key: 'Alt',
                code: 'AltLeft',
                windowsVirtualKeyCode: 18
            });

            this.log('Alt+G shortcut sent successfully');
            return true;
        } catch (e) {
            this.log(`Error sending keyboard shortcut: ${e.message}`);
            return false;
        }
    }

    async connectToPage(page) {
        return new Promise((resolve) => {
            const ws = new WebSocket(page.webSocketDebuggerUrl);
            ws.on('open', () => {
                this.connections.set(page.id, { ws, injected: false });
                resolve(true);
            });
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.id && this.pendingMessages.has(msg.id)) {
                        const { resolve: res, reject: rej } = this.pendingMessages.get(msg.id);
                        this.pendingMessages.delete(msg.id);
                        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
                    }
                } catch (e) { }
            });
            ws.on('error', (err) => {
                this.log(`WS Error on ${page.id}: ${err.message}`);
                this.connections.delete(page.id);
                resolve(false);
            });
            ws.on('close', () => {
                this.connections.delete(page.id);
            });
        });
    }

    async injectAndStart(pageId, config) {
        const conn = this.connections.get(pageId);
        if (!conn) {
            this.log(`Cannot inject into ${pageId}: no connection found`);
            return;
        }
        this.log(`Attempting to inject/start on ${pageId}...`);

        try {
            if (!conn.injected) {
                this.log(`Getting script for injection...`);
                const script = this.getComposedScript();
                this.log(`Script loaded (${script.length} chars), sending to page...`);
                const result = await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: script,
                    userGesture: true,
                    awaitPromise: true
                });

                if (result.exceptionDetails) {
                    this.log(`Injection Exception on ${pageId}: ${result.exceptionDetails.text} ${result.exceptionDetails.exception.description}`);
                } else {
                    conn.injected = true;
                    this.log(`Injected core onto ${pageId}`);
                }
            }

            if (conn.injected) {
                const res = await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: `(function(){
                        const g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : self);
                        if(g && typeof g.__autoAcceptStart === 'function'){
                            g.__autoAcceptStart(${JSON.stringify(config)});
                            return "started";
                        }
                        return "not_found";
                    })()`
                });
                this.log(`Start signal on ${pageId}: ${JSON.stringify(res.result?.value || res)}`);
            }
        } catch (e) {
            this.log(`Failed to start/update on ${pageId}: ${e.message}`);
        }
    }

    getComposedScript() {
        const scriptPath = path.join(__dirname, '..', 'main_scripts', 'full_cdp_script.js');
        this.log(`Loading script from: ${scriptPath}`);

        if (!fs.existsSync(scriptPath)) {
            this.log(`ERROR: Script file not found at ${scriptPath}`);
            throw new Error(`Script file not found: ${scriptPath}`);
        }

        const content = fs.readFileSync(scriptPath, 'utf8');
        this.log(`Script file read successfully: ${content.length} bytes`);
        return content;
    }

    sendCommand(pageId, method, params = {}) {
        const conn = this.connections.get(pageId);
        if (!conn || conn.ws.readyState !== WebSocket.OPEN) return Promise.reject('dead');
        const id = this.messageId++;
        return new Promise((resolve, reject) => {
            this.pendingMessages.set(id, { resolve, reject });
            conn.ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (this.pendingMessages.has(id)) {
                    this.pendingMessages.delete(id);
                    reject(new Error('timeout'));
                }
            }, 2000);
        });
    }

    async hideBackgroundOverlay() {
        for (const [pageId] of this.connections) {
            try {
                await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: 'if(typeof window !== "undefined" && typeof hideOverlay === "function") hideOverlay()'
                });
            } catch (e) { }
        }
    }

    async getStats() {
        const aggregatedStats = { clicks: 0, blocked: 0, fileEdits: 0, terminalCommands: 0, actionsWhileAway: 0 };

        for (const [pageId] of this.connections) {
            try {
                const result = await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: '(function(){ if(typeof window !== "undefined" && window.__autoAcceptGetStats) return JSON.stringify(window.__autoAcceptGetStats()); return "{}"; })()',
                    returnByValue: true
                });

                if (result.result?.value) {
                    const stats = JSON.parse(result.result.value);
                    aggregatedStats.clicks += stats.clicks || 0;
                    aggregatedStats.blocked += stats.blocked || 0;
                    aggregatedStats.fileEdits += stats.fileEdits || 0;
                    aggregatedStats.terminalCommands += stats.terminalCommands || 0;
                    aggregatedStats.actionsWhileAway += stats.actionsWhileAway || 0;
                }
            } catch (e) { }
        }

        return aggregatedStats;
    }

    async resetStats() {
        const aggregatedStats = { clicks: 0, blocked: 0, fileEdits: 0, terminalCommands: 0, actionsWhileAway: 0 };

        for (const [pageId] of this.connections) {
            try {
                const result = await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: '(function(){ if(typeof window !== "undefined" && window.__autoAcceptResetStats) return JSON.stringify(window.__autoAcceptResetStats()); return "{}"; })()',
                    returnByValue: true
                });

                if (result.result?.value) {
                    const stats = JSON.parse(result.result.value);
                    aggregatedStats.clicks += stats.clicks || 0;
                    aggregatedStats.blocked += stats.blocked || 0;
                    aggregatedStats.fileEdits += stats.fileEdits || 0;
                    aggregatedStats.terminalCommands += stats.terminalCommands || 0;
                    aggregatedStats.actionsWhileAway += stats.actionsWhileAway || 0;
                }
            } catch (e) { }
        }

        return aggregatedStats;
    }

    async getSessionSummary() {
        const summary = { clicks: 0, fileEdits: 0, terminalCommands: 0, blocked: 0 };

        for (const [pageId] of this.connections) {
            try {
                const result = await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: '(function(){ if(typeof window !== "undefined" && window.__autoAcceptGetSessionSummary) return JSON.stringify(window.__autoAcceptGetSessionSummary()); return "{}"; })()',
                    returnByValue: true
                });

                if (result.result?.value) {
                    const stats = JSON.parse(result.result.value);
                    summary.clicks += stats.clicks || 0;
                    summary.fileEdits += stats.fileEdits || 0;
                    summary.terminalCommands += stats.terminalCommands || 0;
                    summary.blocked += stats.blocked || 0;
                }
            } catch (e) { }
        }

        const baseSecs = summary.clicks * 5;
        const minMins = Math.max(1, Math.floor((baseSecs * 0.8) / 60));
        const maxMins = Math.ceil((baseSecs * 1.2) / 60);
        summary.estimatedTimeSaved = summary.clicks > 0 ? `${minMins}–${maxMins}` : null;

        return summary;
    }

    async getAwayActions() {
        let total = 0;

        for (const [pageId] of this.connections) {
            try {
                const result = await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: '(function(){ if(typeof window !== "undefined" && window.__autoAcceptGetAwayActions) return window.__autoAcceptGetAwayActions(); return 0; })()',
                    returnByValue: true
                });

                if (result.result?.value) {
                    total += parseInt(result.result.value) || 0;
                }
            } catch (e) { }
        }

        return total;
    }

    async setFocusState(isFocused) {
        for (const [pageId] of this.connections) {
            try {
                await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: `(function(){
                        if(typeof window !== "undefined" && window.__autoAcceptSetFocusState) {
                            window.__autoAcceptSetFocusState(${isFocused});
                        }
                    })()`
                });
            } catch (e) { }
        }
        this.log(`Focus state pushed to all pages: ${isFocused}`);
    }

    getConnectionCount() { return this.connections.size; }
    disconnectAll() {
        for (const [, conn] of this.connections) try { conn.ws.close(); } catch (e) { }
        this.connections.clear();
    }
}

module.exports = { CDPHandler };
