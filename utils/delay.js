// utils/delay.js

/**
 * Returns a random number of milliseconds
 * between min and max (inclusive).
 *
 * Example:
 * randomDelay()            -> 2000-5000 ms
 * randomDelay(1000, 3000)  -> 1000-3000 ms
 */
function randomDelay(min = 2000, max = 5000) {
    return Math.floor(
        Math.random() * (max - min + 1) + min
    );
}

/**
 * Wait helper that can be used directly.
 *
 * Example:
 * await sleep();
 * await sleep(1000, 3000);
 */
async function sleep(min = 2000, max = 5000) {
    const delay = randomDelay(min, max);

    return new Promise(resolve => {
        setTimeout(resolve, delay);
    });
}

function backoffDelay(attempt = 1, base = 2000, max = 20000) {
    return Math.min(max, base * Math.pow(2, Math.max(0, attempt - 1)));
}

async function sleepBackoff(attempt = 1, base = 2000, max = 20000) {
    const delay = backoffDelay(attempt, base, max);
    return sleep(delay, Math.min(delay + 1000, max));
}

module.exports = {
    randomDelay,
    sleep,
    sleepBackoff,
    backoffDelay
};