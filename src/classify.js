const API = 'https://api.typesafe.ai/v1/systemone';

export const PRESET_QUESTIONS = {
    issue: {
        type: 'choice',
        instructions: 'What is the main problem the review reports',
        criteria: {
            crash_bug: 'the app crashes, freezes or has a bug',
            login_account: 'problems logging in or with the account',
            payment_billing: 'charges, refunds, payments or billing problems',
            performance: 'slow, laggy or battery drain',
            ads: 'too many or intrusive ads',
            support: 'customer support did not help or answer',
            ux_design: 'confusing or bad interface',
            feature_request: 'asks for a missing feature',
            content_quality: 'poor content, results or products',
            praise: 'no problem, positive review',
            other: 'none of the above',
        },
    },
    severity: {
        type: 'score',
        instructions: 'how severe is the problem described',
        criteria: ['no problem at all', 'minor annoyance', 'significant problem', 'app is unusable'],
    },
    mentions_crash: { type: 'noul', instructions: 'the review says the app crashes or freezes' },
    mentions_payment: { type: 'noul', instructions: 'the review mentions being charged, billing or refunds' },
    mentions_support: { type: 'noul', instructions: 'the review mentions customer support' },
    mentions_update: { type: 'noul', instructions: 'the review says a recent update made things worse' },
    would_churn: { type: 'noul', instructions: 'the reviewer says they stopped using or will stop using the app' },
};

/** Throws with a clear message on the first bad question. Returns the questions on success. */
export function validateQuestions(questions) {
    if (!questions || typeof questions !== 'object' || Array.isArray(questions)) {
        throw new Error('questions must be an object of {name: question}');
    }
    const names = Object.keys(questions);
    if (names.length === 0) throw new Error('questions must contain at least one question');
    if (names.length > 50) throw new Error(`questions: at most 50 allowed, got ${names.length}`);

    for (const name of names) {
        const q = questions[name];
        const where = `question "${name}"`;
        if (!q || typeof q !== 'object' || Array.isArray(q)) throw new Error(`${where}: must be an object`);
        if (typeof q.instructions !== 'string' || !q.instructions.trim()) {
            throw new Error(`${where}: "instructions" must be a non-empty string`);
        }
        if (q.type === 'noul') continue;
        if (q.type === 'choice') {
            const c = q.criteria;
            if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).length < 2
                || !Object.values(c).every((v) => typeof v === 'string' && v.trim())) {
                throw new Error(`${where}: choice "criteria" must be an object of at least 2 {label: "description"} pairs`);
            }
            continue;
        }
        if (q.type === 'score') {
            const c = q.criteria;
            if (!Array.isArray(c) || c.length < 2 || !c.every((v) => typeof v === 'string' && v.trim())) {
                throw new Error(`${where}: score "criteria" must be a LIST of at least 2 description strings, low-end first`);
            }
            continue;
        }
        throw new Error(`${where}: "type" must be one of noul, choice, score (got ${JSON.stringify(q.type)})`);
    }
    return questions;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One jev call, retrying 429/5xx/network 3 times with 1s/2s/4s backoff. */
export async function askJev(text, questions) {
    const body = JSON.stringify({ state: text.slice(0, 2000), model: 'jev-latest', questions });
    for (let attempt = 0; ; attempt++) {
        let res;
        try {
            res = await fetch(API, {
                method: 'POST',
                headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
                body,
            });
        } catch (err) {
            if (attempt >= 3) throw err;
            await sleep(1000 * 2 ** attempt);
            continue;
        }
        if (res.ok) return res.json();
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
            await sleep(1000 * 2 ** attempt);
            continue;
        }
        throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
}

/** jev answers -> flat dataset columns. */
export function toColumns(answers, confidenceThreshold) {
    const out = {};
    let reviewNeeded = false;
    for (const [name, a] of Object.entries(answers)) {
        if (a.type === 'noul') {
            out[name] = a.noul;
            continue;
        }
        out[name] = a.type === 'choice' ? a.choice : a.score;
        out[`${name}_confidence`] = a.confidence ?? null;
        if (typeof a.confidence === 'number' && a.confidence < confidenceThreshold) reviewNeeded = true;
    }
    out.review_needed = reviewNeeded;
    return out;
}

/** Null columns for reviews we never sent (empty text). */
export function nullColumns(questions) {
    const out = {};
    for (const [name, q] of Object.entries(questions)) {
        out[name] = null;
        if (q.type !== 'noul') out[`${name}_confidence`] = null;
    }
    out.review_needed = null;
    return out;
}

/** Inline semaphore: run fn over items with at most `limit` in flight. */
export async function mapLimit(items, limit, fn) {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
