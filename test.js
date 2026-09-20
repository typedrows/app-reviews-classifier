// node test.js   (live: hits the App Store RSS, Google Play and jev)
import assert from 'node:assert/strict';
if (!process.env.TYPESAFE_API_KEY) process.loadEnvFile(new URL('.env', import.meta.url));
import { PRESET_QUESTIONS, askJev, toColumns, validateQuestions } from './src/classify.js';
import { appstoreReviews, detectApp, googleplayReviews } from './src/sources.js';

// 1. question validation
assert.throws(
    () => validateQuestions({ sev: { type: 'score', instructions: 'x', criteria: { low: 'a', high: 'b' } } }),
    /must be a LIST/,
);
assert.equal(validateQuestions(PRESET_QUESTIONS), PRESET_QUESTIONS);
console.log('1 ok  validateQuestions');

// 2. platform detection
assert.deepEqual(detectApp('https://apps.apple.com/us/app/whatsapp-messenger/id310633997'), { platform: 'appstore', appId: '310633997' });
assert.deepEqual(detectApp('310633997'), { platform: 'appstore', appId: '310633997' });
assert.deepEqual(detectApp('com.whatsapp'), { platform: 'googleplay', appId: 'com.whatsapp' });
assert.deepEqual(detectApp('https://play.google.com/store/apps/details?id=com.whatsapp'), { platform: 'googleplay', appId: 'com.whatsapp' });
console.log('2 ok  detectApp');

// 3. live App Store
const ios = await appstoreReviews('310633997', 'us', 50);
assert.ok(ios.length >= 1, 'no App Store reviews');
assert.ok(ios.every((r) => r.rating >= 1 && r.rating <= 5 && r.text.length > 0), 'bad App Store review');
console.log(`3 ok  App Store: ${ios.length} reviews`);

// 4. live Google Play
const android = await googleplayReviews('com.whatsapp', 'us', 'en', 20);
assert.ok(android.length >= 1, 'no Google Play reviews');
assert.ok(android.every((r) => r.reviewId && typeof r.text === 'string'), 'bad Google Play review');
console.log(`4 ok  Google Play: ${android.length} reviews`);

// 5. live jev
const fixture = 'App keeps crashing every time I try to open my order history. Support never answered my email and I was charged twice.';
const { answers, usage } = await askJev(fixture, PRESET_QUESTIONS);
const cols = toColumns(answers, 0.8);
assert.equal(cols.issue, 'crash_bug');
assert.ok(cols.mentions_payment > 0.5, `mentions_payment=${cols.mentions_payment}`);
assert.ok(cols.mentions_support > 0.5, `mentions_support=${cols.mentions_support}`);
console.log(`5 ok  jev: ${JSON.stringify(cols)} (${usage.input_tokens} input tokens)`);

console.log('all checks passed');
