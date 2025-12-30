/**
 * Analytics State Management Module
 * 
 * Handles initialization, migration, and access to analytics state.
 * 
 * @module analytics/state
 */

(function (exports) {
    'use strict';

    /**
     * Create default stats object.
     * 
     * @returns {Object} Default stats
     */
    function createDefaultStats() {
        return {
            clicks: 0,
            blocked: 0,
            sessions: 0,
            lastSession: null,
            firstClick: null,
            lastClick: null,
            timeSaved: 0,
            actionsWhileAway: 0,
            isWindowFocused: true,
            clicksThisWeek: 0,
            blockedThisWeek: 0,
            sessionsThisWeek: 0,
            lastWeeklyReset: null
        };
    }

    /**
     * Initialize analytics state.
     * Creates state if it doesn't exist, or migrates if needed.
     * 
     * @param {Function} log - Logger function
     */
    function initializeState(log) {
        if (typeof window === 'undefined') return;

        if (!window.__autoAcceptState) {
            window.__autoAcceptState = {
                isRunning: false,
                tabNames: [],
                completionStatus: {},
                sessionID: 0,
                currentMode: null,
                startTimes: {},
                bannedCommands: [],
                stats: createDefaultStats()
            };
            log('[State] Initialized new state');
        } else if (!window.__autoAcceptState.stats) {
            window.__autoAcceptState.stats = createDefaultStats();
            log('[State] Added stats to existing state');
        } else {
            migrateState(log);
        }
    }

    /**
     * Migrate existing stats to include new fields.
     * 
     * @param {Function} log - Logger function
     */
    function migrateState(log) {
        const stats = window.__autoAcceptState.stats;
        let migrated = false;

        // Add actionsWhileAway if missing
        if (stats.actionsWhileAway === undefined) {
            stats.actionsWhileAway = 0;
            migrated = true;
        }

        // Add isWindowFocused if missing
        if (stats.isWindowFocused === undefined) {
            stats.isWindowFocused = true;
            migrated = true;
        }

        // Add weekly stats if missing
        if (stats.clicksThisWeek === undefined) {
            stats.clicksThisWeek = 0;
            migrated = true;
        }
        if (stats.blockedThisWeek === undefined) {
            stats.blockedThisWeek = 0;
            migrated = true;
        }
        if (stats.sessionsThisWeek === undefined) {
            stats.sessionsThisWeek = 0;
            migrated = true;
        }
        if (stats.lastWeeklyReset === undefined) {
            stats.lastWeeklyReset = null;
            migrated = true;
        }

        if (migrated) {
            log('[State] Migrated stats with new fields');
        }
    }

    /**
     * Get current stats (read-only).
     * 
     * @returns {Object} Current stats
     */
    function getStats() {
        if (typeof window === 'undefined') return createDefaultStats();
        return window.__autoAcceptState?.stats || createDefaultStats();
    }

    /**
     * Get mutable stats reference.
     * 
     * @returns {Object} Mutable stats
     */
    function getStatsMutable() {
        if (typeof window === 'undefined') return createDefaultStats();
        if (!window.__autoAcceptState) {
            window.__autoAcceptState = { stats: createDefaultStats() };
        }
        return window.__autoAcceptState.stats;
    }

    // Export for browser (IIFE) or Node.js (testing)
    exports.createDefaultStats = createDefaultStats;
    exports.initializeState = initializeState;
    exports.migrateState = migrateState;
    exports.getStats = getStats;
    exports.getStatsMutable = getStatsMutable;

})(typeof module !== 'undefined' && module.exports ? module.exports : window);
