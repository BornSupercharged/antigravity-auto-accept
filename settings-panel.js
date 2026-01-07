const vscode = require('vscode');

class SettingsPanel {
    static currentPanel = undefined;
    static viewType = 'autoAcceptSettings';

    static createOrShow(extensionUri, context, mode = 'settings') {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (SettingsPanel.currentPanel) {
            // If requesting prompt mode but panel is open, reveal it and update mode
            SettingsPanel.currentPanel.panel.reveal(column);
            SettingsPanel.currentPanel.updateMode(mode);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            SettingsPanel.viewType,
            mode === 'prompt' ? 'Auto Accept Agent' : 'Auto Accept Settings',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
                retainContextWhenHidden: true
            }
        );

        SettingsPanel.currentPanel = new SettingsPanel(panel, extensionUri, context, mode);
    }

    static showUpgradePrompt(context) {
        SettingsPanel.createOrShow(context.extensionUri, context, 'prompt');
    }

    constructor(panel, extensionUri, context, mode) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.context = context;
        this.mode = mode; // 'settings' | 'prompt'
        this.disposables = [];

        this.update();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'setFrequency':
                        await this.context.globalState.update('auto-accept-frequency', message.value);
                        vscode.commands.executeCommand('auto-accept.updateFrequency', message.value);
                        break;
                    case 'getStats':
                        this.sendStats();
                        break;
                    case 'getROIStats':
                        this.sendROIStats();
                        break;
                    case 'updateBannedCommands':
                        await this.context.globalState.update('auto-accept-banned-commands', message.commands);
                        vscode.commands.executeCommand('auto-accept.updateBannedCommands', message.commands);
                        break;
                    case 'getBannedCommands':
                        this.sendBannedCommands();
                        break;
                    case 'dismissPrompt':
                        await this.handleDismiss();
                        break;
                    case 'forceRelaunch':
                        vscode.window.showInformationMessage('Starting forceful relaunch sequence...');
                        try {
                            const result = await vscode.commands.executeCommand('auto-accept.relaunch');
                            this.panel.webview.postMessage({
                                command: 'relaunchComplete',
                                result
                            });
                        } catch (e) {
                            this.panel.webview.postMessage({
                                command: 'relaunchComplete',
                                result: { success: false, message: e.message }
                            });
                        }
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    updateMode(mode) {
        this.mode = mode;
        this.panel.title = mode === 'prompt' ? 'Auto Accept Agent' : 'Auto Accept Settings';
        this.update();
    }

    sendStats() {
        const stats = this.context.globalState.get('auto-accept-stats', {
            clicks: 0,
            sessions: 0,
            lastSession: null
        });
        const frequency = this.context.globalState.get('auto-accept-frequency', 1000);

        this.panel.webview.postMessage({
            command: 'updateStats',
            stats,
            frequency
        });
    }

    async sendROIStats() {
        try {
            const roiStats = await vscode.commands.executeCommand('auto-accept.getROIStats');
            this.panel.webview.postMessage({
                command: 'updateROIStats',
                roiStats
            });
        } catch (e) {
            // ROI stats not available yet
        }
    }

    sendBannedCommands() {
        const defaultBannedCommands = [
            'rm -rf /',
            'rm -rf ~',
            'rm -rf *',
            'format c:',
            'del /f /s /q',
            'rmdir /s /q',
            ':(){:|:&};:',
            'dd if=',
            'mkfs.',
            '> /dev/sda',
            'chmod -R 777 /'
        ];
        const bannedCommands = this.context.globalState.get('auto-accept-banned-commands', defaultBannedCommands);
        this.panel.webview.postMessage({
            command: 'updateBannedCommands',
            bannedCommands
        });
    }

    update() {
        this.panel.webview.html = this.getHtmlContent();
        setTimeout(() => {
            this.sendStats();
            this.sendROIStats();
        }, 100);
    }

    getHtmlContent() {
        const isPrompt = this.mode === 'prompt';

        // Premium Design System - Overriding IDE theme
        const css = `
            :root {
                --bg: #0a0a0c;
                --card-bg: #121216;
                --border: rgba(147, 51, 234, 0.2);
                --border-hover: rgba(147, 51, 234, 0.4);
                --accent: #9333ea;
                --accent-soft: rgba(147, 51, 234, 0.1);
                --green: #22c55e;
                --green-soft: rgba(34, 197, 94, 0.1);
                --fg: #ffffff;
                --fg-dim: rgba(255, 255, 255, 0.6);
                --font: 'Segoe UI', system-ui, -apple-system, sans-serif;
            }

            body {
                font-family: var(--font);
                background: var(--bg);
                color: var(--fg);
                margin: 0;
                padding: 40px 20px;
                display: flex;
                flex-direction: column;
                align-items: center;
                min-height: 100vh;
            }

            .container {
                max-width: 640px;
                width: 100%;
                display: flex;
                flex-direction: column;
                gap: 24px;
            }

            /* Header Section */
            .header {
                text-align: center;
                margin-bottom: 8px;
            }
            .header h1 {
                font-size: 32px;
                font-weight: 800;
                margin: 0;
                letter-spacing: -0.5px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
            }
            .subtitle {
                color: var(--fg-dim);
                font-size: 14px;
                margin-top: 8px;
            }

            /* Sections */
            .section {
                background: var(--card-bg);
                border: 1px solid var(--border);
                border-radius: 12px;
                padding: 24px;
                transition: border-color 0.3s ease;
            }
            .section:hover {
                border-color: var(--border-hover);
            }
            .section-label {
                color: var(--accent);
                font-size: 11px;
                font-weight: 800;
                letter-spacing: 1px;
                text-transform: uppercase;
                margin-bottom: 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            /* Impact Grid */
            .impact-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
            }
            .impact-card {
                background: rgba(0, 0, 0, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.03);
                border-radius: 10px;
                padding: 20px 12px;
                text-align: center;
                transition: transform 0.2s ease;
            }
            .impact-card:hover {
                transform: translateY(-2px);
            }
            .stat-val {
                font-size: 36px;
                font-weight: 800;
                line-height: 1;
                margin-bottom: 8px;
                font-variant-numeric: tabular-nums;
            }
            .stat-label {
                font-size: 11px;
                color: var(--fg-dim);
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            /* Inputs and Buttons */
            input[type="range"] {
                width: 100%;
                accent-color: var(--accent);
                height: 6px;
                border-radius: 3px;
                background: rgba(255,255,255,0.1);
            }
            textarea {
                width: 100%;
                min-height: 140px;
                background: rgba(0,0,0,0.3);
                border: 1px solid var(--border);
                border-radius: 8px;
                color: var(--fg);
                font-family: 'JetBrains Mono', 'Fira Code', monospace;
                font-size: 12px;
                padding: 12px;
                resize: vertical;
                outline: none;
            }
            textarea:focus { border-color: var(--accent); }

            .btn-primary {
                background: var(--accent);
                color: white;
                border: none;
                padding: 14px;
                border-radius: 8px;
                font-weight: 700;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                text-decoration: none;
            }
            .btn-primary:hover {
                filter: brightness(1.2);
                transform: scale(1.01);
            }
            .btn-outline {
                background: transparent;
                border: 1px solid var(--border);
                color: var(--fg);
                padding: 10px 16px;
                border-radius: 8px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .btn-outline:hover {
                background: var(--accent-soft);
                border-color: var(--accent);
            }

            .link-secondary {
                color: var(--accent);
                cursor: pointer;
                text-decoration: none;
                font-size: 13px;
                display: block;
                text-align: center;
                margin-top: 16px;
            }
            .link-secondary:hover { text-decoration: underline; }

            .locked {
                opacity: 0.5;
                pointer-events: none;
                filter: grayscale(1);
            }

            @keyframes shake {
                0%, 100% { transform: translateX(0); }
                10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
                20%, 40%, 60%, 80% { transform: translateX(4px); }
            }
            .shake { animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both; }

            .prompt-card {
                background: var(--card-bg);
                border: 1px solid var(--border);
                border-radius: 12px;
                padding: 32px;
                text-align: center;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            }
            .prompt-title { font-size: 20px; font-weight: 800; margin-bottom: 12px; letter-spacing: -0.5px; }
            .prompt-text { font-size: 15px; color: var(--fg-dim); line-height: 1.6; margin-bottom: 24px; }
        `;

        return `<!DOCTYPE html>
        <html>
        <head><style>${css}</style></head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Auto Accept</h1>
                    <div class="subtitle">Multi-agent automation for Antigravity & Cursor</div>
                </div>

                <div class="section">
                    <div class="section-label">
                        <span>📊 IMPACT DASHBOARD</span>
                        <span style="opacity: 0.4;">Resets Sunday</span>
                    </div>
                    <div class="impact-grid">
                        <div class="impact-card" style="border-bottom: 2px solid var(--green);">
                            <div class="stat-val" id="roiClickCount" style="color: var(--green);">0</div>
                            <div class="stat-label">Clicks Saved</div>
                        </div>
                        <div class="impact-card">
                            <div class="stat-val" id="roiTimeSaved">0m</div>
                            <div class="stat-label">Time Saved</div>
                        </div>
                        <div class="impact-card">
                            <div class="stat-val" id="roiSessionCount">0</div>
                            <div class="stat-label">Sessions</div>
                        </div>
                        <div class="impact-card">
                            <div class="stat-val" id="roiBlockedCount" style="opacity: 0.4;">0</div>
                            <div class="stat-label">Blocked</div>
                        </div>
                    </div>
                </div>

                <div class="section" id="performanceSection">
                    <div class="section-label">
                        <span>⚡ Performance Mode</span>
                        <span class="val-display" id="freqVal" style="color: var(--accent);">...</span>
                    </div>
                    <div>
                        <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 12px; opacity: 0.5;">Instant</span>
                            <div style="flex: 1;"><input type="range" id="freqSlider" min="200" max="3000" step="100" value="1000"></div>
                            <span style="font-size: 12px; opacity: 0.5;">Battery Saving</span>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-label">🛡️ Safety Rules</div>
                    <div style="font-size: 13px; opacity: 0.6; margin-bottom: 16px; line-height: 1.5;">
                        Patterns that will NEVER be auto-accepted.
                    </div>
                    <textarea id="bannedCommandsInput"
                        placeholder="rm -rf /&#10;format c:&#10;del /f /s /q"></textarea>
                    
                    <div style="display: flex; gap: 12px; margin-top: 20px;">
                        <button id="saveBannedBtn" class="btn-primary" style="flex: 2;">
                            Update Rules
                        </button>
                        <button id="resetBannedBtn" class="btn-outline" style="flex: 1;">
                            Reset
                        </button>
                    </div>
                <div id="bannedStatus" style="font-size: 12px; margin-top: 12px; text-align: center; height: 18px;"></div>
                </div>

                <!-- Troubleshooting Section -->
                <div class="section" style="border-color: rgba(239, 68, 68, 0.3);">
                    <div class="section-label" style="color: #ef4444;">Troubleshooting</div>
                    <div style="font-size: 13px; opacity: 0.8; margin-bottom: 16px; line-height: 1.5;">
                        If Auto Accept isn't working or the setup didn't complete, click below to force a re-configuration and restart.
                    </div>
                    <button id="forceRelaunchBtn" class="btn-outline" style="width: 100%; border-color: rgba(239, 68, 68, 0.5); color: #ef4444;">
                        Force Relaunch & Enable
                    </button>
                    <div id="relaunchStatus" style="font-size: 12px; margin-top: 12px; text-align: center; height: 18px;"></div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                
                // --- Polling Logic for Real-time Refresh ---
                function refreshStats() {
                    vscode.postMessage({ command: 'getStats' });
                    vscode.postMessage({ command: 'getROIStats' });
                }
                
                // Refresh every 5 seconds while panel is open
                const refreshInterval = setInterval(refreshStats, 5000);
                
                // --- Event Listeners ---
                const slider = document.getElementById('freqSlider');
                const valDisplay = document.getElementById('freqVal');
                
                if (slider) {
                    slider.addEventListener('input', (e) => {
                         const s = (e.target.value/1000).toFixed(1) + 's';
                         valDisplay.innerText = s;
                         vscode.postMessage({ command: 'setFrequency', value: e.target.value });
                    });
                }

                const bannedInput = document.getElementById('bannedCommandsInput');
                const saveBannedBtn = document.getElementById('saveBannedBtn');
                const resetBannedBtn = document.getElementById('resetBannedBtn');
                const bannedStatus = document.getElementById('bannedStatus');

                const defaultBannedCommands = ["rm -rf /", "rm -rf ~", "rm -rf *", "format c:", "del /f /s /q", "rmdir /s /q", ":(){:|:&};:", "dd if=", "mkfs.", "> /dev/sda", "chmod -R 777 /"];

                if (saveBannedBtn) {
                    saveBannedBtn.addEventListener('click', () => {
                        const lines = bannedInput.value.split('\\n').map(l => l.trim()).filter(l => l.length > 0);
                        vscode.postMessage({ command: 'updateBannedCommands', commands: lines });
                        bannedStatus.innerText = '✓ Safety Rules Updated';
                        bannedStatus.style.color = 'var(--green)';
                        setTimeout(() => { bannedStatus.innerText = ''; }, 3000);
                    });
                }

                if (resetBannedBtn) {
                    resetBannedBtn.addEventListener('click', () => {
                        bannedInput.value = defaultBannedCommands.join('\\n');
                        vscode.postMessage({ command: 'updateBannedCommands', commands: defaultBannedCommands });
                        bannedStatus.innerText = '✓ Defaults Restored';
                        bannedStatus.style.color = 'var(--accent)';
                        setTimeout(() => { bannedStatus.innerText = ''; }, 3000);
                    });
                }

                const forceRelaunchBtn = document.getElementById('forceRelaunchBtn');
                const relaunchStatus = document.getElementById('relaunchStatus');

                if (forceRelaunchBtn) {
                    forceRelaunchBtn.addEventListener('click', () => {
                        forceRelaunchBtn.disabled = true;
                        forceRelaunchBtn.innerText = 'Analyzing Environment...';
                        relaunchStatus.innerText = 'Checking shortcuts and configuration...';
                        
                        setTimeout(() => {
                            vscode.postMessage({ command: 'forceRelaunch' });
                        }, 500);
                    });
                }

                // --- Fancy Count-up Animation ---
                function animateCountUp(element, target, duration = 1200, suffix = '') {
                    const currentVal = parseInt(element.innerText.replace(/[^0-9]/g, '')) || 0;
                    if (currentVal === target && !suffix) return;
                    
                    const startTime = performance.now();
                    function easeOutExpo(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }
                    
                    function update(currentTime) {
                        const elapsed = currentTime - startTime;
                        const progress = Math.min(elapsed / duration, 1);
                        const current = Math.round(currentVal + (target - currentVal) * easeOutExpo(progress));
                        element.innerText = current + suffix;
                        if (progress < 1) requestAnimationFrame(update);
                    }
                    requestAnimationFrame(update);
                }
                
                window.addEventListener('message', e => {
                    const msg = e.data;
                    if (msg.command === 'updateStats') {
                        if (slider) {
                            slider.value = msg.frequency;
                            valDisplay.innerText = (msg.frequency/1000).toFixed(1) + 's';
                        }
                    }
                    if (msg.command === 'updateROIStats') {
                        const roi = msg.roiStats;
                        if (roi) {
                            animateCountUp(document.getElementById('roiClickCount'), roi.clicksThisWeek || 0);
                            animateCountUp(document.getElementById('roiSessionCount'), roi.sessionsThisWeek || 0);
                            animateCountUp(document.getElementById('roiBlockedCount'), roi.blockedThisWeek || 0);
                            document.getElementById('roiTimeSaved').innerText = roi.timeSavedFormatted || '0m';
                        }
                    }
                    if (msg.command === 'updateBannedCommands') {
                        if (bannedInput && msg.bannedCommands) {
                            bannedInput.value = msg.bannedCommands.join('\\n');
                        }
                    }
                    if (msg.command === 'relaunchComplete') {
                        const result = msg.result;
                        const btn = document.getElementById('forceRelaunchBtn');
                        const status = document.getElementById('relaunchStatus');
                        
                        if (btn && status) {
                            btn.disabled = false;
                            btn.innerText = 'Force Relaunch & Enable';
                            
                            if (result.success) {
                                if (result.action === 'none') {
                                    status.innerText = 'System is already optimized! ✅';
                                    status.style.color = 'var(--green)';
                                } else {
                                    // If success but not 'none', the window is likely closing, 
                                    // but if not, we show this:
                                    status.innerText = 'Relaunch initiated...';
                                    status.style.color = 'var(--accent)';
                                }
                            } else {
                                status.innerText = 'Failed: ' + (result.message || 'Unknown error');
                                status.style.color = '#ef4444';
                                btn.classList.add('shake');
                                setTimeout(() => btn.classList.remove('shake'), 500);
                            }
                            
                            // Clear status after 5s
                            setTimeout(() => {
                                if (status.innerText.includes('Failed')) {
                                    status.innerText = '';
                                }
                            }, 5000);
                        }
                    }
                });

                // Initial load
                refreshStats();
                vscode.postMessage({ command: 'getBannedCommands' });
            </script>
        </body>
        </html>`;
    }

    dispose() {
        SettingsPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) d.dispose();
        }
    }
}

module.exports = { SettingsPanel };
