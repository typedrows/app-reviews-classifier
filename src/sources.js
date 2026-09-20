import gplay from 'google-play-scraper';

/** "310633997" or an apps.apple.com URL -> App Store; anything else -> Google Play. */
export function detectApp(input) {
    const s = String(input).trim();
    if (/^\d+$/.test(s)) return { platform: 'appstore', appId: s };
    if (/apple\.com/.test(s)) {
        const m = s.match(/id(\d+)/);
        if (!m) throw new Error(`cannot find an App Store id in "${s}"`);
        return { platform: 'appstore', appId: m[1] };
    }
    const m = s.match(/[?&]id=([^&#]+)/);
    return { platform: 'googleplay', appId: m ? m[1] : s };
}

// ponytail: RSS caps at 500 newest reviews per country; switch to amp-api if buyers ask for history
export async function appstoreReviews(appId, country, max) {
    const out = [];
    for (let page = 1; page <= 10 && out.length < max; page++) {
        const url = `https://itunes.apple.com/${country}/rss/customerreviews/id=${appId}/sortBy=mostRecent/page=${page}/json`;
        const res = await fetch(url);
        if (!res.ok) break;
        const entries = (await res.json())?.feed?.entry ?? [];
        if (!entries.length) break;
        for (const e of entries) {
            if (!e['im:rating']) continue; // the app's own entry, not a review
            out.push({
                platform: 'appstore',
                appId,
                reviewId: e.id?.label ?? null,
                date: new Date(e.updated.label).toISOString(),
                rating: Number(e['im:rating'].label),
                title: e.title?.label ?? null,
                text: e.content?.label ?? '',
                author: e.author?.name?.label ?? null,
                version: e['im:version']?.label ?? null,
                country,
                thumbsUp: null,
                replyText: null,
                url: `https://apps.apple.com/${country}/app/id${appId}?see-all=reviews`,
            });
            if (out.length >= max) break;
        }
    }
    return out;
}

export async function googleplayReviews(appId, country, lang, max) {
    const out = [];
    let token;
    do {
        const page = await gplay.reviews({
            appId,
            sort: gplay.sort.NEWEST,
            num: Math.min(150, max - out.length),
            lang,
            country,
            paginate: true,
            nextPaginationToken: token,
        });
        for (const r of page.data) {
            out.push({
                platform: 'googleplay',
                appId,
                reviewId: r.id,
                date: r.date ? new Date(r.date).toISOString() : null,
                rating: r.score,
                title: null,
                text: r.text ?? '',
                author: r.userName ?? null,
                version: r.version ?? null,
                country,
                thumbsUp: r.thumbsUp ?? null,
                replyText: r.replyText ?? null,
                url: r.url ?? `https://play.google.com/store/apps/details?id=${appId}&reviewId=${r.id}`,
            });
            if (out.length >= max) break;
        }
        token = page.data.length ? page.nextPaginationToken : null;
    } while (token && out.length < max);
    return out;
}
