import assert from "node:assert/strict";
import test from "node:test";
import { fetchEvents } from "../netlify/functions/event-service.mjs";

function event(id, start, end = start) {
  return {
    id,
    title: `Evenemang ${id}`,
    uri: `/evenemang/${id}`,
    info: { start, end, location: { name: "Eskilstuna" } },
  };
}

function events(count, start = "2026-09-25") {
  return Array.from({ length: count }, (_, index) => event(String(index + 1), start));
}

test("ignorerar kumulativt searchInfo.count och behåller begärd sidstorlek", async () => {
  const calls = [];
  const allEvents = events(505);
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get("page"));
    const count = Number(parsed.searchParams.get("count"));
    calls.push({ page, count });

    if (page === 1) {
      return Response.json({
        searchInfo: { count: 12, totalHits: 505 },
        hits: allEvents.slice(0, 12),
      });
    }

    assert.equal(page, 43);
    assert.equal(count, 12);
    return Response.json({
      searchInfo: { count: 505, totalHits: 505 },
      hits: allEvents,
    });
  };

  const result = await fetchEvents(
    { start: "2026-09-25", end: "2026-09-27", include_recurring: true },
    { fetchImpl },
  );

  assert.equal(result.complete, true);
  assert.deepEqual(calls, [{ page: 1, count: 12 }, { page: 43, count: 12 }]);
  assert.equal(result.meta.api_total_hits, 505);
  assert.equal(result.meta.fetched_unique, 505);
});

test("hämtar en ny sista sida om totalHits växer till fler sidor", async () => {
  const calls = [];
  const twentyFive = events(25);
  const fetchImpl = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    calls.push(page);

    if (page === 1) {
      return Response.json({
        searchInfo: { count: 12, totalHits: 24 },
        hits: twentyFive.slice(0, 12),
      });
    }
    if (page === 2) {
      return Response.json({
        searchInfo: { count: 24, totalHits: 25 },
        hits: twentyFive.slice(0, 24),
      });
    }
    return Response.json({
      searchInfo: { count: 25, totalHits: 25 },
      hits: twentyFive,
    });
  };

  const result = await fetchEvents(
    { start: "2026-09-25", end: "2026-09-27", include_recurring: true },
    { fetchImpl },
  );

  assert.equal(result.complete, true);
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(result.meta.api_total_hits, 25);
  assert.equal(result.meta.returned, 25);
});

test("tar med evenemang som började tidigare men pågår under sökperioden", async () => {
  const fetchImpl = async () => Response.json({
    searchInfo: { count: 3, totalHits: 3 },
    hits: [
      event("ongoing", "2026-09-01T10:00:00", "2026-09-30T18:00:00"),
      event("before", "2026-09-01T10:00:00", "2026-09-20T18:00:00"),
      event("after", "2026-09-28T10:00:00", "2026-09-30T18:00:00"),
    ],
  });

  const result = await fetchEvents(
    { start: "2026-09-25", end: "2026-09-27", include_recurring: true },
    { fetchImpl },
  );

  assert.equal(result.complete, true);
  assert.deepEqual(result.events.map(({ id }) => id), ["ongoing"]);
});
