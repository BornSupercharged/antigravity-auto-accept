(function () {
    console.log("%c[AutoAccept] AG Background (No Overlay) Test Initialized", "color: #00ff00; font-weight: bold;");

    // --- Helpers (Mocking utils.js) ---
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
        const docs = getDocuments();
        let results = [];
        for (const doc of docs) {
            results.push(...Array.from(doc.querySelectorAll(selector)));
        }
        return results;
    };

    const updateTabNames = (tabs) => {
        const tabNames = Array.from(tabs).map(tab => tab.textContent.trim());
        if (window.__autoAcceptState) window.__autoAcceptState.tabNames = tabNames;
        console.log(`[AutoAccept] Tabs found: ${tabNames.length}`);
    };

    // --- State Mock ---
    window.__autoAcceptState = window.__autoAcceptState || {
        isRunning: false,
        sessionID: 0,
        tabNames: []
    };

    // --- Logic from auto_accept.js ---
    function isElementVisible(el) {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0.1 && rect.width > 0 && rect.height > 0;
    }

    function isElementClickable(el) {
        const style = window.getComputedStyle(el);
        return style.pointerEvents !== 'none' && !el.disabled && !el.hasAttribute('disabled');
    }

    function isAcceptButton(el) {
        const ACCEPT_PATTERNS = [
            { pattern: 'accept', exact: false }, { pattern: 'accept all', exact: false }, { pattern: 'acceptalt', exact: false },
            { pattern: 'run command', exact: false }, { pattern: 'run', exact: false }, { pattern: 'run code', exact: false },
            { pattern: 'run cell', exact: false }, { pattern: 'run all', exact: false }, { pattern: 'run selection', exact: false },
            { pattern: 'run and debug', exact: false }, { pattern: 'run test', exact: false }, { pattern: 'apply', exact: true },
            { pattern: 'execute', exact: true }, { pattern: 'resume', exact: true }, { pattern: 'retry', exact: true }, { pattern: 'try again', exact: false }
        ];
        const REJECT_PATTERNS = ['skip', 'reject', 'cancel', 'discard', 'deny', 'close', 'other'];
        if (!el || !el.textContent) return false;
        const text = el.textContent.trim().toLowerCase();
        if (text.length === 0 || text.length > 50) return false;
        const matched = ACCEPT_PATTERNS.some(p => p.exact ? text === p.pattern : text.includes(p.pattern));
        if (!matched || REJECT_PATTERNS.some(p => text.includes(p))) return false;
        return isElementVisible(el) && isElementClickable(el);
    }

    function click(selector) {
        const elements = queryAll(selector);
        let clicked = false;
        elements.forEach(el => {
            // Click if it matches patterns, OR if it's the specific "+" conversation button
            if (isAcceptButton(el) || selector.includes('tooltip')) {
                console.log(`[AutoAccept] CLICKING: "${el.textContent.trim() || selector}"`);
                el.click();
                clicked = true;
            }
        });
        return clicked;
    }

    // --- The Poll Runner ---
    window.testAGBackground = async function () {
        if (window.__autoAcceptState.isRunning) {
            console.log("[AutoAccept] Stopping previous test session...");
            window.__autoAcceptState.isRunning = false;
            await new Promise(r => setTimeout(r, 1000));
        }

        window.__autoAcceptState.isRunning = true;
        window.__autoAcceptState.sessionID++;
        const sid = window.__autoAcceptState.sessionID;
        let currentTabIndex = 0;

        console.log(`[AutoAccept] AG-BG Loop started (Session: ${sid})`);

        while (window.__autoAcceptState.isRunning && window.__autoAcceptState.sessionID === sid) {
            console.log(`[AutoAccept] Cycle step. Active index: ${currentTabIndex}`);

            // 1. Click Accept/Retry
            [".bg-ide-button-background", "button"].forEach(t => click(t));
            await new Promise(r => setTimeout(r, 500));

            // 2. Click New Tab button
            click("[data-tooltip-id='new-conversation-tooltip']");
            await new Promise(r => setTimeout(r, 1000));

            // 3. Tab Switching
            const tabs = queryAll('button.grow');
            updateTabNames(tabs);

            if (tabs.length > 0) {
                const nextIndex = currentTabIndex % tabs.length;
                const tabToClick = tabs[nextIndex];
                console.log(`[AutoAccept] Switching to tab ${nextIndex}: "${tabToClick.textContent.trim()}"`);
                tabToClick.click();
                currentTabIndex++;
            }

            await new Promise(r => setTimeout(r, 3000));
        }
        console.log(`[AutoAccept] Session ${sid} exited.`);
    };

    window.stopAGBackground = () => {
        window.__autoAcceptState.isRunning = false;
        console.log("[AutoAccept] Stop signal sent.");
    };

    console.log("Commands:");
    console.log("  %ctestAGBackground() %c- Start", "color: #007bff; font-weight: bold;", "");
    console.log("  %cstopAGBackground() %c- Stop", "color: #dc3545; font-weight: bold;", "");
})();
