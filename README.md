# Adhan on Alexa

Play the adhan on your Amazon Echo at every prayer time, automatically, using your own mosque's timetable. No server to run, no hardware, and it fits inside free plans.

```
Cloudflare Worker (runs every minute)
   │  gets today's times: your mosque's timetable (my-masjid.com)
   │                      or calculated times (Aladhan API) as a fallback
   ▼
Voice Monkey (Routine Trigger)
   ▼
Alexa routine  →  "ask Beautiful Adhan to play an amazing Adhan"  →  your Echo
```

## Features

- **Your mosque's exact times.** Reads the mosque's own yearly timetable from [my-masjid.com](https://my-masjid.com), including BST/GMT changes. If your mosque isn't on my-masjid, or it's unreachable, it uses calculated times from [Aladhan](https://aladhan.com).
- **Jumu'ah.** On Fridays, the Dhuhr adhan plays at the mosque's first Jumu'ah jamaah (with the mosque timetable only).
- **Separate Fajr routine** (optional), for example a different adhan or a lower volume.
- **Times page and test link.** Open the Worker URL to see today's times, and test the adhan whenever you want.
- **Free.** Cloudflare Workers' free plan, plus about 155 of Voice Monkey's 200 free requests a month.

## What you need

- An Amazon Echo and the Alexa app
- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account
- A free [Voice Monkey](https://voicemonkey.io) account (enable its Alexa skill)
- An adhan skill on Alexa, for example **Beautiful Azan**
- [Node.js](https://nodejs.org) on your computer, to deploy

## Setup

### 1. Get the code

```bash
git clone https://github.com/tjthouhid/adhan-worker.git
cd adhan-worker
```

### 2. Voice Monkey

1. In the Voice Monkey console, open **Routine Triggers** and create a trigger, for example `adhan`.
2. Copy its **Device ID**. Voice Monkey adds a suffix, for example `adhan-ab12c`.
3. *(Optional)* Create a second trigger for Fajr and copy its Device ID too.
4. Open **API Tokens**, create a token and copy it.

### 3. Alexa routine

First, find the phrase that works for your skill. Say it to your Echo, for example:

> "Alexa, ask Beautiful Adhan to play an amazing Adhan"

The skill's page in the Alexa app (**Start By Saying**) lists the phrases it understands. Use one of those word for word.

Then, in the Alexa app, go to **More → Routines → +** and set up:

| Setting | Value |
|---|---|
| When this happens | **Smart Home →** your Voice Monkey trigger |
| Action | **Customised →** your phrase without "Alexa", for example `ask Beautiful Adhan to play an amazing Adhan` |
| *(Optional)* Action | **Device settings → Volume**, placed before the adhan |
| From / Alexa will respond from | **Your Echo.** Don't leave it on "the device you speak to". |

Make a second routine for Fajr if you created a Fajr trigger.

> Use **Customised**, not **Skills**. The Skills action only opens the skill, and it then waits for you to answer a question.

### 4. Configure

Edit [`wrangler.toml`](wrangler.toml):

| Variable | What to set |
|---|---|
| `MASJID_GUID` | Your mosque's my-masjid.com ID (see below). Leave empty to use calculated times only. |
| `LATITUDE`, `LONGITUDE`, `TIMEZONE` | Your location, e.g. `51.5406`, `0.1475`, `Europe/London`. Used for the fallback, and `TIMEZONE` is always used. |
| `METHOD` | Calculation method for the fallback. `15` Moonsighting Committee, `3` MWL, `2` ISNA, `1` Karachi, [more](https://aladhan.com/calculation-methods) |
| `SCHOOL` | Asr for the fallback. `1` Hanafi, `0` Shafi'i |
| `LAT_ADJ` | High-latitude rule for the fallback. `3` angle-based (good for the UK) |
| `TUNE` | Minute offsets for the fallback: `Imsak,Fajr,Sunrise,Dhuhr,Asr,Maghrib,Sunset,Isha,Midnight` |
| `DEVICE` | Your Voice Monkey trigger's Device ID, e.g. `adhan-ab12c` |
| `FAJR_DEVICE` | *(Optional)* The Fajr trigger's Device ID. Leave empty to use `DEVICE` for all five prayers. |

#### Finding your mosque's `MASJID_GUID`

Many mosques' prayer-time screens and websites use [my-masjid.com](https://my-masjid.com). Find your mosque there and open its timing screen. The ID is the long `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` code in the link. To check it, open this in a browser:

```
https://time.my-masjid.com/api/TimingsInfoScreen/GetMasjidTimings?GuidId=YOUR_GUID
```

You should see your mosque's name and a year of `salahTimings`.

### 5. Deploy

```bash
npx wrangler login                  # sign in to Cloudflare in the browser
npx wrangler secret put VM_TOKEN    # paste your Voice Monkey API token
npx wrangler secret put TEST_KEY    # choose a password (letters and numbers only)
npx wrangler deploy
```

Wrangler prints your Worker URL, for example `https://adhan-alexa.<your-subdomain>.workers.dev`.

## Check it works

**Today's times.** Open the Worker URL:

```
Prayer times for 20-11-2026 (Europe/London)
Source: mosque
Now: 15:07

Fajr     05:41
Jumu'ah  12:30
Asr      14:17
Maghrib  16:08
Isha     17:42
```

`Source: mosque` means it's using your mosque's timetable. `Source: aladhan` means it's using the fallback.

**Test the adhan now.** Each test uses 1 Voice Monkey request:

```
https://adhan-alexa.<your-subdomain>.workers.dev/?test=1&key=YOUR_TEST_KEY
https://adhan-alexa.<your-subdomain>.workers.dev/?test=1&key=YOUR_TEST_KEY&fajr=1
```

**Live logs.** At prayer time you'll see a `triggered` line:

```bash
npx wrangler tail
```

## Troubleshooting

| What you see | Fix |
|---|---|
| `Forbidden` | Wrong key in the test link. Use only letters and numbers: `%`, `&`, `#`, `?` and `+` break URLs. To set a new one, run `npx wrangler secret put TEST_KEY`. |
| `Failed to trigger … 401` | Wrong Voice Monkey token. Run `npx wrangler secret put VM_TOKEN` again. |
| `Failed to trigger … 404` or "device not found" | `DEVICE` / `FAJR_DEVICE` must be the exact **Device ID**, with its suffix, e.g. `adhan-ab12c`. |
| Alexa says *"To control a video device…"* | The routine's phrase isn't one the skill understands. Use the exact phrase from the skill's page, and set **From** to your Echo. |
| Alexa opens the skill and asks a question | You used the **Skills** action. Use **Customised** with the full phrase instead. |
| Times are a few minutes off | Set `MASJID_GUID` to your mosque's ID, or adjust `TUNE` for the fallback. |

## Costs

- **Cloudflare Workers (free plan):** the cron runs 1,440 times a day. The free plan allows 100,000 requests a day.
- **Voice Monkey (free plan):** 5 prayers × 31 days is about 155 triggers a month, inside the 200 free requests. That leaves about 45 tests a month.
- **API calls:** timetables are cached at Cloudflare's edge for 6 hours, so my-masjid.com and Aladhan are called only a few times a day.

## How it works

[`src/index.js`](src/index.js) has two handlers:

- **`scheduled`** runs every minute. It gets today's times, using the in-memory cache first, then my-masjid.com, then Aladhan. If the current `HH:MM` in your timezone matches a prayer time, it calls Voice Monkey with the right trigger.
- **`fetch`** serves the times page and the `?test=1` link.

## License

[MIT](LICENSE). Use it, change it and share it freely. May Allah accept it from all of us.
