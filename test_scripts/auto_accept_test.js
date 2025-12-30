(function () {
    console.log("%c[AutoAccept] Test Suite Initialized", "color: #00ff00; font-weight: bold;");

    // --- Helpers from utils.js ---
    const assert = (condition, message) => {
        if (!condition) throw new Error(message || "Assertion failed");
    };

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

    // --- State & Logic from auto_accept.js ---
    function isElementVisible(el) {
        const win = el.ownerDocument.defaultView || window;
        const style = win.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            parseFloat(style.opacity) > 0.1 &&
            rect.width > 0 &&
            rect.height > 0;
    }

    function isElementClickable(el) {
        const win = el.ownerDocument.defaultView || window;
        const style = win.getComputedStyle(el);
        return style.pointerEvents !== 'none' && !el.disabled && !el.hasAttribute('disabled');
    }

    function isAcceptButton(el) {
        const ACCEPT_PATTERNS = [
            { pattern: 'accept', exact: false },
            { pattern: 'accept all', exact: false },
            { pattern: 'acceptalt', exact: false },
            { pattern: 'run command', exact: false },
            { pattern: 'run', exact: false },
            { pattern: 'run code', exact: false },
            { pattern: 'run cell', exact: false },
            { pattern: 'run all', exact: false },
            { pattern: 'run selection', exact: false },
            { pattern: 'run and debug', exact: false },
            { pattern: 'run test', exact: false },
            { pattern: 'apply', exact: true },
            { pattern: 'execute', exact: true },
            { pattern: 'resume', exact: true },
            { pattern: 'retry', exact: true },
            { pattern: 'try again', exact: false }
        ];
        const REJECT_PATTERNS = ['skip', 'reject', 'cancel', 'discard', 'deny', 'close', 'other'];

        if (!el || !el.textContent) return false;
        const text = el.textContent.trim().toLowerCase();
        if (text.length === 0 || text.length > 50) return false;

        const matched = ACCEPT_PATTERNS.some(p => p.exact ? text === p.pattern : text.includes(p.pattern));
        if (!matched) return false;

        if (REJECT_PATTERNS.some(p => text.includes(p))) {
            console.log(`[AutoAccept] Rejected (negative): "${text}"`);
            return false;
        }

        const visible = isElementVisible(el);
        const clickable = isElementClickable(el);
        if (!visible || !clickable) {
            console.log(`[AutoAccept] Rejected (state): "${text}" (V:${visible}, C:${clickable})`);
            return false;
        }

        console.log(`[AutoAccept] Found: "${text}"`);
        return true;
    }

    function focusOnPanel(panelSelector) {
        if (!panelSelector) return;
        const docs = getDocuments();
        for (const doc of docs) {
            const panel = doc.querySelector(panelSelector);
            if (panel) {
                panel.focus();
                break;
            }
        }
    }

    function click(targetSelectors, panelSelector) {
        focusOnPanel(panelSelector);
        const targets = Array.isArray(targetSelectors) ? targetSelectors : [targetSelectors];
        const docs = getDocuments();
        const discoveredElements = [];

        if (targets.includes('div.full-input-box')) {
            for (const doc of docs) {
                const inputBox = doc.querySelector('div.full-input-box');
                if (inputBox) {
                    let sibling = inputBox.previousElementSibling;
                    let count = 0;
                    while (sibling && count < 5) {
                        ['div[class*="button"]', 'button', '[class*="anysphere"]'].forEach(s => {
                            sibling.querySelectorAll(s).forEach(el => discoveredElements.push(el));
                        });
                        sibling = sibling.previousElementSibling;
                        count++;
                    }
                }
            }
        }

        for (const target of targets) {
            if (typeof target === 'string') {
                for (const doc of docs) {
                    doc.querySelectorAll(target).forEach(el => discoveredElements.push(el));
                }
            }
        }

        const uniqueElements = [...new Set(discoveredElements)];
        let clickCount = 0;
        for (const el of uniqueElements) {
            if (isAcceptButton(el)) {
                console.log(`[AutoAccept] %cCLICKING: "${el.textContent.trim()}"`, "color: #007bff; font-weight: bold;");
                el.click();
                clickCount++;
            }
        }
        return clickCount;
    }

    // --- Main Exported Test Runner ---
    window.testAutoAccept = function (mode = 'cursor') {
        assert(['cursor', 'antigravity'].includes(mode), "Mode must be 'cursor' or 'antigravity'");
        const buttons = mode === 'cursor' ? ['run'] : ['accept', 'retry'];

        let targetSelectors = [];
        let panelSelector = null;

        if (buttons.includes("run")) {
            targetSelectors.push('div.full-input-box', 'button', '[class*="anysphere"]');
            panelSelector = "#workbench\\.parts\\.auxiliarybar";
        }
        if (buttons.includes("accept") || buttons.includes("retry")) {
            targetSelectors.push(".bg-ide-button-background", "button");
            panelSelector = "#antigravity\\.agentPanel";
        }

        console.log(`[AutoAccept] Running test for ${mode.toUpperCase()}...`);
        const result = click(targetSelectors, panelSelector);
        console.log(`[AutoAccept] Test complete. Buttons clicked: ${result}`);
    };

    console.log("To run the test, type: %ctestAutoAccept('cursor')", "color: #ced4da; font-family: monospace;");
    console.log("Or for antigravity: %ctestAutoAccept('antigravity')", "color: #ced4da; font-family: monospace;");
})();