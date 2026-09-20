import { Actor, log } from 'apify';
import { PRESET_QUESTIONS, askJev, mapLimit, nullColumns, toColumns, validateQuestions } from './classify.js';
import { appstoreReviews, detectApp, googleplayReviews } from './sources.js';

const CONCURRENCY = 30;

await Actor.init();
const started = Date.now();

const {
    apps = [],
    countries = ['us'],
    language = 'en',
    maxReviewsPerApp = 500,
    classify = true,
    questions,
    confidenceThreshold = 0.8,
} = (await Actor.getInput()) ?? {};

if (!apps.length) throw new Error('Input "apps" is required: App Store ids/URLs or Google Play package ids/URLs.');
// Fail fast, before a single request goes out.
const schema = classify ? validateQuestions(questions ?? PRESET_QUESTIONS) : null;
if (classify && !process.env.TYPESAFE_API_KEY) {
    throw new Error('TYPESAFE_API_KEY env var is missing. Set it as a secret env var, or run with classify: false.');
}

const targets = apps.map(detectApp);
const blanks = classify ? nullColumns(schema) : {};
let scraped = 0;
let classified = 0;
let tokens = 0;
let stop = false;

/** true when the run hit the user's max charge for this event. */
const charge = async (eventName, count) => {
    if (!count) return false;
    const res = await Actor.charge({ eventName, count });
    return res?.eventChargeLimitReached === true;
};

for (const { platform, appId } of targets) {
    for (const country of countries) {
        if (stop) break;
        log.info(`Scraping ${platform} ${appId} (${country})`);
        const reviews = platform === 'appstore'
            ? await appstoreReviews(appId, country, maxReviewsPerApp)
            : await googleplayReviews(appId, country, language, maxReviewsPerApp);
        log.info(`Got ${reviews.length} reviews for ${appId} (${country})`);

        if (classify) {
            let ok = 0;
            await mapLimit(reviews, CONCURRENCY, async (r) => {
                if (stop || !r.text?.trim()) {
                    Object.assign(r, blanks);
                    return;
                }
                try {
                    const { answers, usage } = await askJev(r.text, schema);
                    Object.assign(r, toColumns(answers, confidenceThreshold));
                    tokens += usage?.input_tokens ?? 0;
                    ok += 1;
                } catch (err) {
                    Object.assign(r, blanks, { classification_error: String(err.message ?? err) });
                }
            });
            classified += ok;
            if (await charge('review-classified', ok)) {
                log.warning('Max charge reached for review-classified; finishing up.');
                stop = true;
            }
        }

        await Actor.pushData(reviews);
        scraped += reviews.length;
        if (await charge('review-scraped', reviews.length)) {
            log.warning('Max charge reached for review-scraped; finishing up.');
            stop = true;
        }
    }
}

log.info(`Done: ${scraped} reviews scraped, ${classified} classified, ${tokens} jev input tokens, ${((Date.now() - started) / 1000).toFixed(1)}s elapsed.`);
await Actor.exit();
