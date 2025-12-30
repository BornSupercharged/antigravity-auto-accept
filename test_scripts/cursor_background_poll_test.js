/**
 * Paste this into the console, THEN run: api.start()
 */
const api = (function () {
    "use strict";

    const log = (msg, isSuccess = false) => {
        const color = isSuccess ? "#00ff00" : "#007bff";
        console.log(`%c[AutoAccept] ${msg}`, `color: ${color}; font-weight: ${isSuccess ? 'bold' : 'normal'};`);
    };

    // Safe State
    if (!window.__autoAcceptState) {
        window.__autoAcceptState = { isRunning: false, sessionID: 0 };
    }

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
        const combined = [];
        getDocuments().forEach(doc => {
            try { combined.push(...Array.from(doc.querySelectorAll(selector))); } catch (e) { }
        });
        return combined;
    };

    const performClick = (selectors) => {
        let count = 0;
        const found = [];

        // Scan for buttons
        selectors.forEach(s => queryAll(s).forEach(el => found.push(el)));

        [...new Set(found)].forEach(el => {
            const text = (el.textContent || "").toLowerCase();
            if ((text.includes('run') || text.includes('apply')) && el.getBoundingClientRect().width > 0) {
                log(`Clicking: "${text.trim()}"`);
                el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                count++;
            }
        });
        return count;
    };

    window.testCursorBackground = async function () {
        window.__autoAcceptState.isRunning = true;
        window.__autoAcceptState.sessionID++;
        const sid = window.__autoAcceptState.sessionID;
        let index = 0;

        log(`Loop Started. ID: ${sid}`, true);

        while (window.__autoAcceptState.isRunning && window.__autoAcceptState.sessionID === sid) {
            log(`Cycle ${index}...`);

            // Click Run/Apply
            performClick(['button', '[class*="button"]', '[class*="anysphere"]']);

            await new Promise(r => setTimeout(r, 1000));

            // Switch Tabs - Scoped specifically to the right sidebar (auxiliary bar) to avoid terminal tabs
            const tabs = queryAll('#workbench\\.parts\\.auxiliarybar ul[role="tablist"] li[role="tab"]');
            if (tabs.length > 0) {
                const target = tabs[index % tabs.length];
                log(`Tab -> ${target.textContent.trim()}`);
                target.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                index++;
            } else {
                log("No AI panel tabs found in auxiliary bar.", false);
            }

            await new Promise(r => setTimeout(r, 3000));
        }
        log("Exited loop.");
    };

    window.stopCursorBackground = () => { window.__autoAcceptState.isRunning = false; log("Stopped."); };

    log("Initialized. Run: api.start()", true);

    return {
        start: window.testCursorBackground,
        stop: window.stopCursorBackground,
        status: () => window.__autoAcceptState
    };
})();

// usage: api.start()