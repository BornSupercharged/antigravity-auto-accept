// Main entry point for auto-accept logic
import * as utils from './utils.js';
import { simplePoll } from './simple_poll.js'
import { antigravityBackgroundPoll } from './antigravity_background_poll.js'
import { cursorBackgroundPoll } from './cursor_background_poll.js'

export function main(isPro, isBackgroundMode, settings) {
    let ide = utils.getIDEName()
    utils.assert(ide == "antgravity" || ide == "cursor", "platform is not supported")

    let simplePollingInterval = settings.get('simplePollingInterval')
    if (ide == "antigravity") {
        if (isPro) {
            if (isBackgroundMode) {
                antigravityBackgroundPoll()
            }
            simplePoll(["accept", "retry"], simplePollingInterval)
        }
        simplePoll(["accept"], simplePollingInterval)
    }
    else if (ide == "cursor") {
        if (isPro) {
            if (isBackgroundMode) {
                cursorBackgroundPoll()
            }
            simplePoll(["run", "retry"], simplePollingInterval)
        }
        simplePoll(["run"], simplePollingInterval)
    }

    return
}