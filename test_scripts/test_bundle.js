/**
 * FULL CDP CORE BUNDLE
 * Monolithic script for browser-side injection.
 * Combines utils, auto-accept, overlay, background polls, and lifecycle management.
 */
(function () {
    "use strict";

    // Guard: Bail out immediately if not in a browser context (e.g., service worker)
    if (typeof window === 'undefined') return;

    // --- 0. INITIALIZATION & STATE ---
    window.__autoAcceptState = window.__autoAcceptState || {
        isRunning: false,
        tabNames: [],
        completionStatus: {},
        sessionID: 0,
        currentMode: null,
        startTimes: {}
    };

    const log = (msg, isSuccess = false) => {
        const color = isSuccess ? "#00ff00" : "#3b82f6";
        console.log(`%c[AutoAccept] ${msg}`, `color: ${color}; font-weight: bold;`);
    };

    // --- 1. UTILS ---
    const getDocuments = (root = document) => {
        let docs = [root];
        try {
            const iframes = root.querySelectorAll('iframe, frame');
            for (const iframe of iframes) {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (iframeDoc) docs.push(...getDocuments(iframeDoc));
                } catch (e) { }
            }
        } catch (e) { }
        return docs;
    };

    const queryAll = (selector) => {
        const results = [];
        getDocuments().forEach(doc => {
            try { results.push(...Array.from(doc.querySelectorAll(selector))); } catch (e) { }
        });
        return results;
    };

    // Helper to strip time suffixes like "3m", "4h", "12s"
    const stripTimeSuffix = (text) => {
        return (text || '').trim().replace(/\s*\d+[smh]$/, '').trim();
    };

    const updateTabNames = (tabs) => {
        const tabNames = Array.from(tabs).map(tab => stripTimeSuffix(tab.textContent));

        if (JSON.stringify(window.__autoAcceptState.tabNames) !== JSON.stringify(tabNames)) {
            log(`updateTabNames: Detected ${tabNames.length} tabs: ${tabNames.join(', ')}`);
            window.__autoAcceptState.tabNames = tabNames;
        }
    };

    // Completion states: undefined (not started) | 'working' | 'done'
    const updateConversationCompletionState = (rawTabName, status) => {
        const tabName = stripTimeSuffix(rawTabName);
        const current = window.__autoAcceptState.completionStatus[tabName];
        if (current !== status) {
            log(`[State] ${tabName}: ${current} → ${status}`);
            window.__autoAcceptState.completionStatus[tabName] = status;
        }
    };

    // --- 2. OVERLAY LOGIC ---
    const OVERLAY_ID = '__autoAcceptBgOverlay';
    const STYLE_ID = '__autoAcceptBgStyles';
    const STYLES = `
        #__autoAcceptBgOverlay { position: fixed; background: rgba(0, 0, 0, 0.98); z-index: 2147483647; font-family: sans-serif; color: #fff; display: flex; flex-direction: column; justify-content: center; align-items: center; pointer-events: none; opacity: 0; transition: opacity 0.3s; }
        #__autoAcceptBgOverlay.visible { opacity: 1; }
        .aab-slot { margin-bottom: 12px; width: 80%; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; }
        .aab-header { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px; }
        .aab-progress-track { height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; }
        .aab-progress-fill { height: 100%; width: 20%; background: #6b7280; transition: width 0.3s, background 0.3s; }
        .aab-slot.working .aab-progress-fill { background: #a855f7; }
        .aab-slot.done .aab-progress-fill { background: #22c55e; }
        .aab-slot .status-text { color: #6b7280; }
        .aab-slot.working .status-text { color: #a855f7; }
        .aab-slot.done .status-text { color: #22c55e; }
    `;

    // Called ONCE when background mode is enabled
    function showOverlay() {
        if (document.getElementById(OVERLAY_ID)) {
            log('[Overlay] Already exists, skipping creation');
            return;
        }

        log('[Overlay] Creating overlay...');
        const state = window.__autoAcceptState;

        // Inject styles
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = STYLES;
            document.head.appendChild(style);
            log('[Overlay] Styles injected');
        }

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;

        // Create container
        const container = document.createElement('div');
        container.id = 'aab-c';
        container.style.cssText = 'width:100%; display:flex; flex-direction:column; align-items:center;';
        overlay.appendChild(container);

        document.body.appendChild(overlay);
        log('[Overlay] Overlay appended to body');

        // Find panel and sync position
        const ide = state.currentMode || 'cursor';
        let panel = null;
        if (ide === 'antigravity') {
            panel = queryAll('#antigravity\\.agentPanel').find(p => p.offsetWidth > 50);
        } else {
            panel = queryAll('#workbench\\.parts\\.auxiliarybar').find(p => p.offsetWidth > 50);
        }

        if (panel) {
            log(`[Overlay] Found panel for ${ide}, syncing position`);
            const sync = () => {
                const r = panel.getBoundingClientRect();
                Object.assign(overlay.style, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
            };
            sync();
            new ResizeObserver(sync).observe(panel);
        } else {
            log('[Overlay] No panel found, using fullscreen');
            Object.assign(overlay.style, { top: '0', left: '0', width: '100%', height: '100%' });
        }

        // Add initial waiting message
        const waitingDiv = document.createElement('div');
        waitingDiv.className = 'aab-waiting';
        waitingDiv.style.cssText = 'color:#888; font-size:12px;';
        waitingDiv.textContent = 'Scanning for conversations...';
        container.appendChild(waitingDiv);

        requestAnimationFrame(() => overlay.classList.add('visible'));
    }

    // Called on each loop iteration to update content (never creates/destroys)
    function updateOverlay() {
        const state = window.__autoAcceptState;
        const container = document.getElementById('aab-c');

        if (!container) {
            log('[Overlay] updateOverlay: No container found, skipping');
            return;
        }

        log(`[Overlay] updateOverlay: tabs=${state.tabNames?.length || 0}, completions=${JSON.stringify(state.completionStatus || {})}`);

        const newNames = state.tabNames || [];

        // Handle waiting state
        if (newNames.length === 0) {
            if (!container.querySelector('.aab-waiting')) {
                container.textContent = '';
                const waitingDiv = document.createElement('div');
                waitingDiv.className = 'aab-waiting';
                waitingDiv.style.cssText = 'color:#888; font-size:12px;';
                waitingDiv.textContent = 'Scanning for conversations...';
                container.appendChild(waitingDiv);
            }
            return;
        }

        // Remove waiting if tabs exist
        const waiting = container.querySelector('.aab-waiting');
        if (waiting) waiting.remove();

        const currentSlots = Array.from(container.querySelectorAll('.aab-slot'));

        // Remove old slots
        currentSlots.forEach(slot => {
            const name = slot.getAttribute('data-name');
            if (!newNames.includes(name)) slot.remove();
        });

        // Add/Update slots
        newNames.forEach(name => {
            const status = state.completionStatus[name]; // undefined, 'working', or 'done'
            const isDone = status === 'done';
            const isWorking = status === 'working';
            const statusClass = isDone ? 'done' : (isWorking ? 'working' : '');
            const statusText = isDone ? 'DONE' : (isWorking ? 'WORKING' : 'WAITING');
            const progressWidth = isDone ? '100%' : (isWorking ? '60%' : '20%');

            let slot = container.querySelector(`.aab-slot[data-name="${name}"]`);

            if (!slot) {
                slot = document.createElement('div');
                slot.className = `aab-slot ${statusClass}`;
                slot.setAttribute('data-name', name);

                const header = document.createElement('div');
                header.className = 'aab-header';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = name;
                header.appendChild(nameSpan);

                const statusSpan = document.createElement('span');
                statusSpan.className = 'status-text';
                statusSpan.textContent = statusText;
                header.appendChild(statusSpan);

                slot.appendChild(header);

                const track = document.createElement('div');
                track.className = 'aab-progress-track';

                const fill = document.createElement('div');
                fill.className = 'aab-progress-fill';
                fill.style.width = progressWidth;
                track.appendChild(fill);

                slot.appendChild(track);
                container.appendChild(slot);
                log(`[Overlay] Created slot: ${name} (${statusText})`);
            } else {
                // Update existing
                slot.className = `aab-slot ${statusClass}`;

                const statusSpan = slot.querySelector('.status-text');
                if (statusSpan) statusSpan.textContent = statusText;

                const bar = slot.querySelector('.aab-progress-fill');
                if (bar) bar.style.width = progressWidth;
            }
        });
    }

    // Called ONCE when background mode is disabled
    function hideOverlay() {
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) {
            log('[Overlay] Hiding overlay...');
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
        }
    }

    // --- 3. CLICKING LOGIC ---
    function isAcceptButton(el) {
        const text = (el.textContent || "").trim().toLowerCase();
        if (text.length === 0 || text.length > 50) return false;
        const patterns = ['accept', 'run', 'retry', 'apply', 'execute'];
        const rejects = ['skip', 'reject', 'cancel', 'close', 'refine'];
        if (rejects.some(r => text.includes(r))) return false;
        if (!patterns.some(p => text.includes(p))) return false;

        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && rect.width > 0 && style.pointerEvents !== 'none' && !el.disabled;
    }

    function performClick(selectors) {
        const found = [];
        selectors.forEach(s => queryAll(s).forEach(el => found.push(el)));
        let clicked = 0;
        const uniqueFound = [...new Set(found)];
        // log(`performClick: Found ${ uniqueFound.length } potential buttons with selectors: ${ selectors.join(', ') } `);

        uniqueFound.forEach(el => {
            if (isAcceptButton(el)) {
                log(`Clicking: "${el.textContent.trim()}"`);
                el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                clicked++;
            }
        });
        return clicked;
    }

    // --- 4. POLL LOOPS ---
    async function cursorLoop(sid) {
        log('[Loop] cursorLoop STARTED');
        let index = 0;
        let cycle = 0;
        while (window.__autoAcceptState.isRunning && window.__autoAcceptState.sessionID === sid) {
            cycle++;
            log(`[Loop] Cycle ${cycle}: Starting...`);

            const clicked = performClick(['button', '[class*="button"]', '[class*="anysphere"]']);
            log(`[Loop] Cycle ${cycle}: Clicked ${clicked} buttons`);

            await new Promise(r => setTimeout(r, 800));

            const tabs = queryAll('#workbench\\.parts\\.auxiliarybar ul[role="tablist"] li[role="tab"]');
            log(`[Loop] Cycle ${cycle}: Found ${tabs.length} tabs`);

            updateTabNames(tabs);

            if (tabs.length > 0) {
                const targetTab = tabs[index % tabs.length];
                log(`[Loop] Cycle ${cycle}: Clicking tab "${targetTab.textContent?.trim()}"`);
                targetTab.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                index++;
            }

            const state = window.__autoAcceptState;
            log(`[Loop] Cycle ${cycle}: State = { tabs: ${state.tabNames?.length || 0}, isRunning: ${state.isRunning}, sid: ${state.sessionID} }`);

            updateOverlay();
            log(`[Loop] Cycle ${cycle}: Overlay updated, waiting 3s...`);

            await new Promise(r => setTimeout(r, 3000));
        }
        log('[Loop] cursorLoop STOPPED');
    }

    async function antigravityLoop(sid) {
        log('[Loop] antigravityLoop STARTED');
        let index = 0;
        let cycle = 0;
        while (window.__autoAcceptState.isRunning && window.__autoAcceptState.sessionID === sid) {
            cycle++;
            log(`[Loop] Cycle ${cycle}: Starting...`);

            // Click accept/run buttons (Antigravity specific selectors)
            const clicked = performClick(['.bg-ide-button-background']);
            log(`[Loop] Cycle ${cycle}: Clicked ${clicked} accept buttons`);

            await new Promise(r => setTimeout(r, 800));

            // Optional: click New Tab button to cycle
            const nt = queryAll("[data-tooltip-id='new-conversation-tooltip']")[0];
            if (nt) {
                log(`[Loop] Cycle ${cycle}: Clicking New Tab button`);
                nt.click();
            }
            await new Promise(r => setTimeout(r, 1000));

            // Re-query tabs after potential navigation
            const tabsAfter = queryAll('button.grow');
            log(`[Loop] Cycle ${cycle}: Found ${tabsAfter.length} tabs`);
            updateTabNames(tabsAfter);

            // Click next tab in rotation and check its completion
            let clickedTabName = null;
            if (tabsAfter.length > 0) {
                const targetTab = tabsAfter[index % tabsAfter.length];
                clickedTabName = stripTimeSuffix(targetTab.textContent);
                log(`[Loop] Cycle ${cycle}: Clicking tab "${clickedTabName}"`);
                targetTab.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                index++;
            }

            // Wait longer for content to load (1.5s instead of 0.5s)
            await new Promise(r => setTimeout(r, 1500));

            // Check for completion badges (Good/Bad) after clicking
            const allSpans = queryAll('span');
            const feedbackTexts = allSpans
                .filter(s => {
                    const t = s.textContent.trim();
                    return t === 'Good' || t === 'Bad';
                })
                .map(s => s.textContent.trim());

            log(`[Loop] Cycle ${cycle}: Found ${feedbackTexts.length} Good/Bad badges`);

            // Update completion status for the tab we just clicked
            if (clickedTabName && feedbackTexts.length > 0) {
                updateConversationCompletionState(clickedTabName, 'done');
            } else if (clickedTabName && !window.__autoAcceptState.completionStatus[clickedTabName]) {
                // Leave as undefined (WAITING)
            }

            const state = window.__autoAcceptState;
            log(`[Loop] Cycle ${cycle}: State = { tabs: ${state.tabNames?.length || 0}, completions: ${JSON.stringify(state.completionStatus)} }`);

            updateOverlay();
            log(`[Loop] Cycle ${cycle}: Overlay updated, waiting 3s...`);

            await new Promise(r => setTimeout(r, 3000));
        }
        log('[Loop] antigravityLoop STOPPED');
    }

    // --- 5. LIFECYCLE API ---
    window.__autoAcceptStart = function (config) {
        try {
            const ide = (config.ide || 'cursor').toLowerCase();
            const isPro = config.isPro !== false;
            const isBG = config.isBackgroundMode === true;

            log(`__autoAcceptStart called: ide=${ide}, isPro=${isPro}, isBG=${isBG}`);

            const state = window.__autoAcceptState;

            // Skip restart only if EXACTLY the same config
            if (state.isRunning && state.currentMode === ide && state.isBackgroundMode === isBG) {
                log(`Already running with same config, skipping`);
                return;
            }

            // Stop previous loop if switching
            if (state.isRunning) {
                log(`Stopping previous session...`);
                state.isRunning = false;
            }

            state.isRunning = true;
            state.currentMode = ide;
            state.isBackgroundMode = isBG;
            state.sessionID++;
            const sid = state.sessionID;

            log(`Agent Loaded (IDE: ${ide}, BG: ${isBG}, isPro: ${isPro})`, true);

            if (isBG && isPro) {
                log(`[BG] Creating overlay and starting loop...`);
                showOverlay();
                log(`[BG] Overlay created, starting ${ide} loop...`);
                if (ide === 'cursor') cursorLoop(sid);
                else antigravityLoop(sid);
            } else if (isBG && !isPro) {
                log(`[BG] Background mode requires Pro, showing overlay anyway...`);
                showOverlay();
                if (ide === 'cursor') cursorLoop(sid);
                else antigravityLoop(sid);
            } else {
                hideOverlay();
                log(`Starting static poll loop...`);
                (async function staticLoop() {
                    while (state.isRunning && state.sessionID === sid) {
                        performClick(['button', '[class*="button"]', '[class*="anysphere"]']);
                        await new Promise(r => setTimeout(r, config.pollInterval || 1000));
                    }
                })();
            }
        } catch (e) {
            log(`ERROR in __autoAcceptStart: ${e.message}`);
            console.error('[AutoAccept] Start error:', e);
        }
    };

    window.__autoAcceptStop = function () {
        window.__autoAcceptState.isRunning = false;
        hideOverlay();
        log("Agent Stopped.");
    };

    log("Core Bundle Initialized.", true);
})();
