# Property Management Prospect Finder v1

A Streamlit application for discovering and qualifying independent residential property management companies.

## What it does

- Searches Google Maps through SearchAPI.io.
- Deduplicates companies by domain and company name.
- Reviews public website text for residential and maintenance-related signals.
- Excludes or penalizes large national firms, franchises, HOA-only firms, commercial-only firms, self-storage, and vacation-rental-only operators.
- Produces an ICP score, fit rating, likely property-management software, maintenance opportunity summary, and optional cold-email personalization.
- Exports qualified prospects to CSV.
- Optionally pushes filtered records into Airtable.

## Run locally

```bash
cd prospect-finder
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
streamlit run app.py
```

Open the local URL shown by Streamlit, normally `http://localhost:8501`.

## Required configuration

Add your SearchAPI.io key in `.env`:

```env
SEARCHAPI_API_KEY=your_key_here
```

The app uses SearchAPI.io's Google Maps engine. OpenAI is optional; without it, the application still applies deterministic qualification rules.

## Optional AI qualification

Add an OpenAI API key:

```env
OPENAI_API_KEY=your_key_here
```

AI qualification adds cautious estimates and produces a personalized first sentence. It is instructed not to invent portfolio size, software, or company facts.

## Optional Airtable export

Create a `Prospects` table, then add:

```env
AIRTABLE_TOKEN=your_personal_access_token
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
AIRTABLE_TABLE_NAME=Prospects
```

The easiest first setup is to run a search, download the generated CSV, and import it into Airtable. Airtable will create the necessary fields. After that, direct push should work as long as the field names remain unchanged.

## Recommended first searches

- `residential property management company` in `Indianapolis, IN`
- `single family property management` in `Cincinnati, OH`
- `apartment property management company` in `Louisville, KY`

Start with 25 results per market and manually review all High-fit records before sending outreach.

## Important limitations

- Public websites rarely disclose exact unit counts, so `Estimated Units` may say that the number is not publicly confirmed.
- Website scraping can fail when sites block automated requests or render all content with JavaScript.
- Search results are leads, not verified outreach contacts. Decision-maker and email enrichment should be added through Clay before sending.
- The app intentionally avoids claiming exact savings or workflow weaknesses without supporting evidence.
