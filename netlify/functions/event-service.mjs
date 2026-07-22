const API_URL = "https://visiteskilstuna.se/rest-api/Evenemang/events";
const EVENT_BASE_URL = "https://evenemang.eskilstuna.se";
const PAGE_SIZE = 12;
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 12_000;
const TOTAL_DEADLINE_MS = 52_000;

const RECURRING_PATTERNS = [
  "sprakcafe", "laxhjalp", "biltraff", "bakluckeloppis",
  "visningar av museismedjan", "visning av tillfallig utstallning",
  "sommaroppet med visningar och cafe", "foraldrafika", "epa-hang",
  "lasning for integration", "prova pa paddling",
  "friluftsaktiviteter med eriswed", "medborgardialog",
  "extra oppet pa stadsmuseet", "skaparverkstad", "vilsta musikcafe",
];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function buildUrl(page, count, filters, query) {
  const params = new URLSearchParams({
    count: String(count),
    filters: JSON.stringify(filters),
    page: String(page),
    query,
    timestamp: String(Date.now()),
  });
  return `${API_URL}?${params}`;
}

function describeError(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return "tidsgränsen för anslutningen överskreds";
  }
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function fetchPage(page, count, filters, query, fetchImpl, deadlineAt) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (Date.now() >= deadlineAt) {
      throw new Error(`API-sida ${page} avbröts eftersom den totala tidsgränsen nåddes`);
    }

    const remaining = deadlineAt - Date.now();
    const timeout = Math.max(1, Math.min(REQUEST_TIMEOUT_MS, remaining));
    try {
      const response = await fetchImpl(buildUrl(page, count, filters, query), {
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent": "VisitEskilstunaEventMCP/1.0",
        },
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await wait(Math.min(1_500 * (2 ** (attempt - 1)), Math.max(0, deadlineAt - Date.now())));
      }
    }
  }
  throw new Error(
    `API-sida ${page} misslyckades efter ${MAX_ATTEMPTS} försök: ${describeError(lastError)}`,
  );
}

function eventKey(event) {
  const info = event.info ?? {};
  return String(event.id || event.uri || `${event.title ?? ""}-${info.start ?? ""}`);
}

function startDate(event) {
  return String(event?.info?.start ?? "").slice(0, 10);
}

function shouldHideRecurring(event) {
  const haystack = normalize(`${event.title ?? ""} ${event?.info?.location?.name ?? ""}`);
  return RECURRING_PATTERNS.some((pattern) => haystack.includes(pattern));
}

function firstPresent(event, paths) {
  for (const path of paths) {
    let value = event;
    for (const key of path) value = value && typeof value === "object" ? value[key] : undefined;
    if (value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length)) {
      return value;
    }
  }
  return undefined;
}

function collectStrings(value) {
  if (value === undefined || value === null) return [];
  if (["string", "number", "boolean"].includes(typeof value)) return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}

function directUrl(uri) {
  if (!uri) return null;
  if (/^https?:\/\//.test(String(uri))) return String(uri);
  return `${EVENT_BASE_URL}${String(uri).startsWith("/") ? "" : "/"}${uri}`;
}

function simplify(event) {
  const info = event.info ?? {};
  const location = info.location ?? {};
  return {
    id: event.id ?? null,
    title: event.title ?? null,
    start: info.start ?? null,
    end: info.end ?? null,
    location: typeof location === "object" ? location.name ?? null : null,
    description: firstPresent(event, [
      ["description"], ["info", "description"], ["preamble"], ["summary"],
    ]) ?? null,
    categories: collectStrings(firstPresent(event, [
      ["categories"], ["category"], ["info", "categories"], ["info", "category"], ["tags"],
    ])),
    areas: collectStrings(firstPresent(event, [
      ["areas"], ["area"], ["info", "areas"], ["info", "area"],
      ["info", "location", "areas"], ["info", "location", "area"],
    ])),
    url: directUrl(event.uri || event.url),
  };
}

export async function fetchEvents(input, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const filters = {};
  if (input.category) filters.category = [input.category];
  if (input.area) filters.area = [input.area];
  const query = input.query?.trim() ?? "";
  const deadlineAt = Date.now() + TOTAL_DEADLINE_MS;

  try {
    const first = await fetchPage(1, PAGE_SIZE, filters, query, fetchImpl, deadlineAt);
    const count = Number(first.searchInfo?.count || PAGE_SIZE);
    const totalHits = Number(first.searchInfo?.totalHits ?? first.hits?.length ?? 0);
    const totalPages = count > 0 ? Math.max(1, Math.ceil(totalHits / count)) : 1;
    // API:t returnerar kumulativa resultat: sida 2 innehåller de första 24
    // träffarna, sida 3 de första 36 och så vidare. Sista sidan räcker därför
    // för ett komplett underlag och undviker många överlappande anrop.
    const completePage = totalPages > 1
      ? await fetchPage(totalPages, count, filters, query, fetchImpl, deadlineAt)
      : first;
    const completeHits = completePage.hits ?? [];
    if (completeHits.length < totalHits) {
      throw new Error(
        `API-sida ${totalPages} innehöll ${completeHits.length} av ${totalHits} förväntade träffar`,
      );
    }

    const seen = new Set();
    const events = [];
    for (const event of completeHits) {
      const key = eventKey(event);
      if (!seen.has(key)) {
        seen.add(key);
        events.push(event);
      }
    }

    const dated = events.filter((event) => input.start <= startDate(event) && startDate(event) <= input.end);
    const filtered = input.include_recurring ? dated : dated.filter((event) => !shouldHideRecurring(event));
    filtered.sort((a, b) => String(a?.info?.start ?? "").localeCompare(String(b?.info?.start ?? "")));

    return {
      status: "ok",
      complete: true,
      meta: {
        start: input.start,
        end: input.end,
        api_filters: filters,
        api_query: query,
        api_total_hits: totalHits,
        fetched_unique: events.length,
        within_date_range: dated.length,
        returned: filtered.length,
        recurring_hidden: !input.include_recurring,
        retrieved_at: now().toISOString(),
      },
      events: filtered.map(simplify),
    };
  } catch (error) {
    return {
      status: "blocked",
      complete: false,
      error: `Kunde inte hämta evenemang: ${describeError(error)}`,
      instruction: "Avbryt den evenemangsberoende leveransen. Ersätt inte API-underlaget med sökresultat, minnesuppgifter eller ett ofullständigt urval.",
    };
  }
}
