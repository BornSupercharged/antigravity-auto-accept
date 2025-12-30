/**
 * STANDALONE CONSOLE OVERLAY TEST SCRIPT
 * Paste this directly into the Cursor/Antigravity console to test the overlay UI.
 * Uses pure DOM construction (no innerHTML) to work under strict Trusted Types.
 */
(function () {
    "use strict";

    // Guard for non-browser contexts
    if (typeof window === 'undefined') return;

    const log = (msg) => console.log(`%c[OverlayTest] ${msg}`, 'color: #3b82f6; font-weight: bold;');

    // Setup dummy state
    window.__autoAcceptState = window.__autoAcceptState || {
        isRunning: true,
        tabNames: ["Chat 1", "Search & Replace", "Refactor Tool"],
        completionStatus: {
            "Chat 1": false,
            "Search & Replace": true,
            "Refactor Tool": false
        },
        currentMode: document.title.toLowerCase().includes('antigravity') ? 'antigravity' : 'cursor',
        startTimes: {}
    };

    // Utils
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

    // Constants
    const OVERLAY_ID = '__autoAcceptBgOverlay';
    const STYLE_ID = '__autoAcceptBgStyles';
    const STYLES = `
        #__autoAcceptBgOverlay {
            position: fixed;
            background: rgba(0, 0, 0, 0.98);
            z-index: 2147483647;
            font-family: system-ui, -apple-system, sans-serif;
            color: #fff;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s;
        }
        #__autoAcceptBgOverlay.visible { opacity: 1; }
        .aab-slot { margin-bottom: 12px; width: 80%; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; }
        .aab-header { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px; }
        .aab-progress-track { height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; }
        .aab-progress-fill { height: 100%; width: 50%; background: #3b82f6; transition: width 0.3s; }
        .done .aab-progress-fill { background: #22c55e; width: 100% !important; }
    `;

    function manageOverlay() {
        const state = window.__autoAcceptState;
        log(`manageOverlay: isRunning=${state.isRunning}, tabs=${state.tabNames?.length || 0}`);

        let overlay = document.getElementById(OVERLAY_ID);

        // 1. Create Overlay (pure DOM, no innerHTML)
        if (!overlay) {
            log('Creating overlay element...');

            // Inject styles
            if (!document.getElementById(STYLE_ID)) {
                const style = document.createElement('style');
                style.id = STYLE_ID;
                style.textContent = STYLES;
                document.head.appendChild(style);
                log('Styles injected');
            }

            // Create overlay
            overlay = document.createElement('div');
            overlay.id = OVERLAY_ID;

            // Create container (NO innerHTML)
            const container = document.createElement('div');
            container.id = 'aab-c';
            container.style.cssText = 'width:100%; display:flex; flex-direction:column; align-items:center;';
            overlay.appendChild(container);

            document.body.appendChild(overlay);
            log('Overlay appended to body');

            // Find panel
            const ide = state.currentMode || 'cursor';
            let panel = null;
            if (ide === 'antigravity') {
                panel = queryAll('#antigravity\\.agentPanel').find(p => p.offsetWidth > 50);
            } else {
                panel = queryAll('#workbench\\.parts\\.auxiliarybar').find(p => p.offsetWidth > 50);
            }

            if (panel) {
                log(`Found panel for ${ide}`);
                const sync = () => {
                    const r = panel.getBoundingClientRect();
                    Object.assign(overlay.style, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
                };
                sync();
                new ResizeObserver(sync).observe(panel);
            } else {
                log('No panel found, using fullscreen');
                Object.assign(overlay.style, { top: '0', left: '0', width: '100%', height: '100%' });
            }

            requestAnimationFrame(() => overlay.classList.add('visible'));
        }

        // 2. Update Slots
        const container = document.getElementById('aab-c');
        if (!container) {
            log('ERROR: Container not found!');
            return;
        }

        const newNames = state.tabNames || [];

        // Waiting state
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

        // Remove waiting
        const waiting = container.querySelector('.aab-waiting');
        if (waiting) waiting.remove();

        const currentSlots = Array.from(container.querySelectorAll('.aab-slot'));

        // Remove old slots
        currentSlots.forEach(slot => {
            const name = slot.getAttribute('data-name');
            if (!newNames.includes(name)) slot.remove();
        });

        // Add/Update slots (pure DOM)
        newNames.forEach(name => {
            const done = state.completionStatus[name];
            let slot = container.querySelector(`.aab-slot[data-name="${name}"]`);

            if (!slot) {
                slot = document.createElement('div');
                slot.className = `aab-slot ${done ? 'done' : ''}`;
                slot.setAttribute('data-name', name);

                const header = document.createElement('div');
                header.className = 'aab-header';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = name;
                header.appendChild(nameSpan);

                const statusSpan = document.createElement('span');
                statusSpan.className = 'status-text';
                statusSpan.textContent = done ? 'DONE' : 'WORKING';
                header.appendChild(statusSpan);

                slot.appendChild(header);

                const track = document.createElement('div');
                track.className = 'aab-progress-track';

                const fill = document.createElement('div');
                fill.className = 'aab-progress-fill';
                fill.style.width = done ? '100%' : '50%';
                track.appendChild(fill);

                slot.appendChild(track);
                container.appendChild(slot);
                log(`Created slot: ${name}`);
            } else {
                if (done && !slot.classList.contains('done')) slot.classList.add('done');
                else if (!done && slot.classList.contains('done')) slot.classList.remove('done');

                const statusSpan = slot.querySelector('.status-text');
                if (statusSpan) statusSpan.textContent = done ? 'DONE' : 'WORKING';

                const bar = slot.querySelector('.aab-progress-fill');
                if (bar) bar.style.width = done ? '100%' : '50%';
            }
        });
    }

    // Execute
    log('Starting overlay test...');
    manageOverlay();

    // Export toggle helper
    window.toggleTestOverlay = () => {
        const o = document.getElementById(OVERLAY_ID);
        if (o) {
            o.classList.toggle('visible');
            if (!o.classList.contains('visible')) {
                setTimeout(() => o.remove(), 300);
            }
            log('Overlay toggled');
        } else {
            manageOverlay();
        }
    };

    log("SUCCESS: Overlay rendered. Run 'toggleTestOverlay()' to hide/show.");
})();
