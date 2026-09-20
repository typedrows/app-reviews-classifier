# App Reviews Classifier

Scrapes App Store and Google Play reviews for any list of apps and, by default, adds **typed classification columns** to every review using [jev](https://typesafe.ai), a non-generative classifier. You get a dataset you can pivot on immediately: main issue, severity, and boolean-style flags — no prompt engineering, no LLM bill.

Classification columns cost about one tenth of LLM-based alternatives.

## Input

| Field | Type | Default | Description |
|---|---|---|---|
| `apps` | array of strings | *required* | App Store numeric ids or URLs (`310633997`, `https://apps.apple.com/us/app/whatsapp-messenger/id310633997`) and Google Play package ids or URLs (`com.whatsapp`, `https://play.google.com/store/apps/details?id=com.whatsapp`). All digits or an `apps.apple.com` URL means App Store, anything else Google Play. |
| `countries` | array of strings | `["us"]` | Two-letter store country codes. Every app is scraped in every country. |
| `language` | string | `"en"` | Google Play review language (ignored for the App Store). |
| `maxReviewsPerApp` | integer | `500` | Per app and country, 1–20000. |
| `classify` | boolean | `true` | Add the classification columns. |
| `questions` | object | preset | Custom jev question schema replacing the preset (see below). |
| `confidenceThreshold` | number | `0.8` | Rows with any choice/score confidence below this get `review_needed: true`. |

## Output

One dataset item per review.

| Field | Description |
|---|---|
| `platform` | `"appstore"` or `"googleplay"` |
| `appId` | Numeric App Store id or Google Play package id |
| `reviewId` | Store review id |
| `date` | ISO 8601 |
| `rating` | 1–5 |
| `title` | App Store only, `null` on Google Play |
| `text` | Review body |
| `author` | Reviewer name |
| `version` | App version reviewed |
| `country` | Store country code |
| `thumbsUp` | Google Play only, `null` on the App Store |
| `replyText` | Developer reply, Google Play only |
| `url` | Link back to the review / reviews page |

When `classify` is on, each question adds a column named after the question:

| Question | Type | Column |
|---|---|---|
| `issue` | choice | `issue` (label) + `issue_confidence` |
| `severity` | score | `severity` (0–3) + `severity_confidence` |
| `mentions_crash` | noul | `mentions_crash` (probability 0–1) |
| `mentions_payment` | noul | `mentions_payment` |
| `mentions_support` | noul | `mentions_support` |
| `mentions_update` | noul | `mentions_update` |
| `would_churn` | noul | `would_churn` |

Plus `review_needed` (true when any choice/score confidence is under `confidenceThreshold`). `issue` labels: `crash_bug`, `login_account`, `payment_billing`, `performance`, `ads`, `support`, `ux_design`, `feature_request`, `content_quality`, `praise`, `other`.

Reviews with empty text get `null` classification columns and are not charged. A review whose classification failed after retries gets a `classification_error` string and is not charged either.

### Custom questions

Replace the preset with up to 50 of your own:

```json
{
  "is_refund_request": { "type": "noul", "instructions": "the reviewer asks for a refund" },
  "topic": { "type": "choice", "instructions": "what the review is about",
             "criteria": { "price": "cost or value for money", "speed": "how fast the app is" } },
  "urgency": { "type": "score", "instructions": "how urgent is this",
               "criteria": ["not urgent", "somewhat urgent", "drop everything"] }
}
```

`choice` criteria is an object of `{label: description}`, `score` criteria is a **list** of descriptions from low end to high end. Bad schemas fail before anything is scraped.

## Pricing (pay per event)

| Event | Charged |
|---|---|
| Review scraped (built-in dataset item) | Once per review row written, USD 0.0001 |
| Review classified | Once per review successfully classified, USD 0.0005 |

Set `classify: false` to pay only for scraping.

## Requirements

Set `TYPESAFE_API_KEY` as a secret environment variable on the actor (only needed when `classify` is true). Get one at [typesafe.ai](https://typesafe.ai).

## Limitations

- **App Store: 500 newest reviews per country, maximum.** That is the ceiling of Apple's public RSS feed, not of this actor. Add more `countries` to get more reviews; there is no way to reach older history through this endpoint.
- App Store reviews have no thumbs-up count or developer reply.
- Google Play returns reviews in one language/country at a time; both are inputs.
- jev sees the first 2,000 characters of a review.

## Run it locally

```bash
npm install
node test.js                                    # self-check, hits all three live APIs
APIFY_LOCAL_STORAGE_DIR=./storage node --env-file=.env src/main.js
```

with `storage/key_value_stores/default/INPUT.json` holding the input and `.env` holding `TYPESAFE_API_KEY=...`.
