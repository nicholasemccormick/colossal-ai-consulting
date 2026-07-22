import os
import re
import json
from typing import Any
from urllib.parse import urlparse

import pandas as pd
import requests
import streamlit as st
from dotenv import load_dotenv

load_dotenv()

SEARCHAPI_URL = "https://www.searchapi.io/api/v1/search"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

NATIONAL_EXCLUSIONS = {
    "greystar", "cardone", "firstservice residential", "real property management",
    "rpm living", "avenue5", "lincoln property company", "cushman & wakefield",
    "cb re", "cbre", "colliers", "jll", "bozzuto", "cortland"
}
SOFTWARE_HINTS = ["appfolio", "buildium", "rentvine", "propertyware", "doorloop", "tenantcloud", "rent manager"]
RESIDENTIAL_HINTS = ["residential", "homes", "apartments", "single family", "multifamily", "tenant", "rentals"]
NEGATIVE_HINTS = ["commercial only", "self storage", "hoa only", "association management only", "vacation rental only"]

st.set_page_config(page_title="Colossal Prospect Finder", page_icon="🏢", layout="wide")

st.markdown("""
<style>
:root{--ink:#0b0b0d;--paper:#ece5d4;--accent:#c2884a}
.stApp{background:var(--ink);color:var(--paper)}
.block-container{max-width:1400px;padding-top:2rem}
h1,h2,h3{letter-spacing:-.035em}.stButton>button,.stDownloadButton>button{background:var(--accent);color:var(--ink);border:0;font-weight:700}
[data-testid="stMetricValue"]{color:var(--accent)}
</style>
""", unsafe_allow_html=True)


def secret(name: str) -> str:
    try:
        return st.secrets.get(name, os.getenv(name, ""))
    except Exception:
        return os.getenv(name, "")


def normalize_url(url: str) -> str:
    if not url:
        return ""
    return url if url.startswith(("http://", "https://")) else f"https://{url}"


def domain(url: str) -> str:
    try:
        return urlparse(normalize_url(url)).netloc.lower().replace("www.", "")
    except Exception:
        return ""


def fetch_site_text(url: str) -> str:
    if not url:
        return ""
    try:
        r = requests.get(normalize_url(url), timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", r.text, flags=re.I | re.S)
        text = re.sub(r"<[^>]+>", " ", text)
        return re.sub(r"\s+", " ", text).strip()[:15000]
    except Exception:
        return ""


def search_maps(api_key: str, query: str, location: str) -> list[dict[str, Any]]:
    params = {"engine": "google_maps", "q": f"{query} in {location}", "api_key": api_key}
    r = requests.get(SEARCHAPI_URL, params=params, timeout=45)
    r.raise_for_status()
    data = r.json()
    return data.get("local_results", [])


def parse_maps_result(item: dict[str, Any], location: str) -> dict[str, Any]:
    website = item.get("website") or item.get("links", {}).get("website") or ""
    title = item.get("title") or item.get("name") or ""
    address = item.get("address") or ""
    return {
        "Company": title,
        "Website": website,
        "Domain": domain(website),
        "Phone": item.get("phone", ""),
        "Address": address,
        "Location Searched": location,
        "Google Rating": item.get("rating", ""),
        "Google Reviews": item.get("reviews", item.get("reviews_count", "")),
        "Category": item.get("type", item.get("category", "")),
        "Google Maps URL": item.get("link", item.get("place_link", "")),
    }


def detect_software(text: str) -> str:
    low = text.lower()
    for name in SOFTWARE_HINTS:
        if name in low:
            return name.title()
    return "Unknown"


def heuristic_score(row: dict[str, Any], site_text: str) -> tuple[int, str, str, str]:
    company = str(row.get("Company", "")).lower()
    category = str(row.get("Category", "")).lower()
    combined = f"{company} {category} {site_text}".lower()

    independent = not any(x in combined for x in NATIONAL_EXCLUSIONS)
    residential = any(x in combined for x in RESIDENTIAL_HINTS)
    disqualified = any(x in combined for x in NEGATIVE_HINTS)
    software = detect_software(combined)

    score = 20 if independent else 0
    score += 20 if residential else 8
    score += 10 if software != "Unknown" else 5

    opportunity_signals = 0
    for phrase in ["maintenance request", "resident portal", "owner portal", "submit a request", "emergency maintenance"]:
        if phrase in combined:
            opportunity_signals += 1
    score += min(20, opportunity_signals * 4)

    reviews = row.get("Google Reviews")
    try:
        reviews_n = int(str(reviews).replace(",", ""))
    except Exception:
        reviews_n = 0
    score += 15 if 15 <= reviews_n <= 500 else 8 if reviews_n > 0 else 3
    score += 15 if row.get("Website") else 5
    if disqualified:
        score = min(score, 25)
    score = min(100, score)

    fit = "High" if score >= 75 else "Medium" if score >= 55 else "Low"
    reason = "Independent residential operator with visible maintenance workflow signals." if fit == "High" else "Potential fit, but portfolio size and service mix need confirmation." if fit == "Medium" else "Weak or unclear residential fit; review before outreach."
    opportunity = "Review vendor follow-up, resident status updates, work-order triage, invoice handling, and owner reporting for automation opportunities."
    return score, fit, software, reason + " " + opportunity


def ai_analyze(api_key: str, row: dict[str, Any], site_text: str) -> dict[str, Any]:
    prompt = f"""You are qualifying a prospect for Colossal AI Consulting, which helps independent residential property management companies improve maintenance operations.

Company data:
{json.dumps(row, ensure_ascii=False)}

Website text:
{site_text[:12000]}

Return ONLY valid JSON with these keys:
residential_focus (true/false), independent (true/false), likely_software (string), estimated_units (string), icp_score (integer 0-100), fit (High/Medium/Low), disqualification_reason (string), maintenance_opportunity (string), personalization (string).

Rules:
- Do not invent facts. Use cautious language such as appears, likely, or not publicly confirmed.
- Penalize national firms, franchises, HOA-only, commercial-only, self-storage, and vacation-rental-only firms.
- Favor independent residential managers likely operating roughly 250-2500 units.
- Personalization must be one factual, non-creepy sentence suitable for a cold email.
"""
    r = requests.post(
        OPENAI_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": "gpt-4.1-mini", "messages": [{"role": "user", "content": prompt}], "temperature": 0.2, "response_format": {"type": "json_object"}},
        timeout=60,
    )
    r.raise_for_status()
    return json.loads(r.json()["choices"][0]["message"]["content"])


def push_airtable(df: pd.DataFrame, token: str, base_id: str, table_name: str) -> tuple[int, list[str]]:
    url = f"https://api.airtable.com/v0/{base_id}/{requests.utils.quote(table_name, safe='')}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    count, errors = 0, []
    for _, r in df.iterrows():
        fields = {k: ("" if pd.isna(v) else v) for k, v in r.to_dict().items()}
        try:
            resp = requests.post(url, headers=headers, json={"fields": fields}, timeout=30)
            resp.raise_for_status()
            count += 1
        except Exception as exc:
            errors.append(f"{r.get('Company','Unknown')}: {exc}")
    return count, errors


st.title("Property Management Prospect Finder")
st.caption("Discover, qualify, research, and export independent residential property management prospects.")

with st.sidebar:
    st.header("Configuration")
    search_key = st.text_input("SearchAPI key", value=secret("SEARCHAPI_API_KEY"), type="password")
    openai_key = st.text_input("OpenAI API key (optional)", value=secret("OPENAI_API_KEY"), type="password")
    st.divider()
    location = st.text_input("City / market", "Indianapolis, IN")
    query = st.text_input("Search phrase", "residential property management company")
    max_results = st.slider("Maximum prospects", 5, 100, 25, 5)
    use_ai = st.checkbox("Use AI website qualification", value=bool(openai_key))

if "prospects" not in st.session_state:
    st.session_state.prospects = pd.DataFrame()

c1, c2, c3 = st.columns(3)
with c1:
    run = st.button("Find Prospects", use_container_width=True)
with c2:
    uploaded = st.file_uploader("Or import a CSV", type=["csv"], label_visibility="collapsed")
with c3:
    clear = st.button("Clear Results", use_container_width=True)

if clear:
    st.session_state.prospects = pd.DataFrame()

if uploaded is not None:
    st.session_state.prospects = pd.read_csv(uploaded)

if run:
    if not search_key:
        st.error("Add your SearchAPI key in the sidebar.")
    else:
        try:
            with st.spinner("Searching Google Maps..."):
                raw = search_maps(search_key, query, location)[:max_results]
                records = [parse_maps_result(x, location) for x in raw]
                df = pd.DataFrame(records).drop_duplicates(subset=["Domain", "Company"], keep="first")

            progress = st.progress(0, "Researching websites...")
            enriched = []
            total = max(len(df), 1)
            for idx, row in df.iterrows():
                record = row.to_dict()
                text = fetch_site_text(record.get("Website", ""))
                score, fit, software, summary = heuristic_score(record, text)
                record.update({"ICP Score": score, "Fit": fit, "PM Software": software, "AI Opportunity": summary, "Personalization": ""})
                if use_ai and openai_key:
                    try:
                        ai = ai_analyze(openai_key, record, text)
                        record.update({
                            "Residential Focus": ai.get("residential_focus"),
                            "Independent": ai.get("independent"),
                            "PM Software": ai.get("likely_software") or software,
                            "Estimated Units": ai.get("estimated_units", "Not publicly confirmed"),
                            "ICP Score": ai.get("icp_score", score),
                            "Fit": ai.get("fit", fit),
                            "Disqualification Reason": ai.get("disqualification_reason", ""),
                            "AI Opportunity": ai.get("maintenance_opportunity", summary),
                            "Personalization": ai.get("personalization", ""),
                        })
                    except Exception as exc:
                        record["AI Error"] = str(exc)
                enriched.append(record)
                progress.progress((idx + 1) / total, f"Analyzed {idx + 1} of {len(df)}")
            st.session_state.prospects = pd.DataFrame(enriched).sort_values("ICP Score", ascending=False)
            progress.empty()
            st.success(f"Found and scored {len(enriched)} prospects.")
        except Exception as exc:
            st.error(f"Search failed: {exc}")

if not st.session_state.prospects.empty:
    df = st.session_state.prospects
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Prospects", len(df))
    m2.metric("High Fit", int((df.get("Fit", pd.Series(dtype=str)) == "High").sum()))
    m3.metric("Average ICP Score", round(pd.to_numeric(df.get("ICP Score"), errors="coerce").mean(), 1))
    m4.metric("With Website", int(df.get("Website", pd.Series(dtype=str)).fillna("").ne("").sum()))

    min_score = st.slider("Minimum ICP score", 0, 100, 55)
    filtered = df[pd.to_numeric(df["ICP Score"], errors="coerce").fillna(0) >= min_score].copy()
    st.data_editor(filtered, use_container_width=True, hide_index=True, num_rows="dynamic")

    csv = filtered.to_csv(index=False).encode("utf-8")
    st.download_button("Download Qualified Prospects CSV", csv, "colossal-qualified-prospects.csv", "text/csv")

    with st.expander("Push filtered prospects to Airtable"):
        airtable_token = st.text_input("Airtable personal access token", value=secret("AIRTABLE_TOKEN"), type="password")
        base_id = st.text_input("Base ID", value=secret("AIRTABLE_BASE_ID"))
        table_name = st.text_input("Table name", value=secret("AIRTABLE_TABLE_NAME") or "Prospects")
        if st.button("Push to Airtable"):
            if not all([airtable_token, base_id, table_name]):
                st.error("Add the Airtable token, Base ID, and table name.")
            else:
                with st.spinner("Sending records to Airtable..."):
                    count, errors = push_airtable(filtered, airtable_token, base_id, table_name)
                st.success(f"Added {count} records to Airtable.")
                if errors:
                    st.warning("Some records failed:\n" + "\n".join(errors[:10]))
else:
    st.info("Enter a market and click **Find Prospects**, or import a CSV to score an existing list.")
