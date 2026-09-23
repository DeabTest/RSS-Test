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

test("accepterar senaste kompletta totalsiffran när antalet träffar minskar under hämtningen", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    calls.push(page);
    if (page === 1) {
      return Response.json({
        searchInfo: { count: 2, totalHits: 4 },
        hits: [event("a", "2026-09-25"), event("b", "2026-09-26")],
      });
    }
    return Response.json({
      searchInfo: { count: 2, totalHits: 3 },
      hits: [
        event("a", "2026-09-25"),
        event("b", "2026-09-26"),
        event("c", "2026-09-27"),
      ],
    });
  };

  const result = await fetchEvents(
    { start: "2026-09-25", end: "2026-09-27", include_recurring: true },
    { fetchImpl },
  );

  assert.equal(result.complete, true);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(result.meta.api_total_hits, 3);
  assert.equal(result.meta.returned, 3);
});

test("hämtar en ny sista sida om träffantalet växer till fler sidor", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    calls.push(page);
    if (page === 1) {
      return Response.json({
        searchInfo: { count: 2, totalHits: 4 },
        hits: [event("a", "2026-09-25"), event("b", "2026-09-25")],
      });
    }
    if (page === 2) {
      return Response.json({
        searchInfo: { count: 2, totalHits: 5 },
        hits: [
          event("a", "2026-09-25"), event("b", "2026-09-25"),
          event("c", "2026-09-26"), event("d", "2026-09-26"),
        ],
      });
    }
    return Response.json({
      searchInfo: { count: 2, totalHits: 5 },
      hits: [
        event("a", "2026-09-25"), event("b", "2026-09-25"),
        event("c", "2026-09-26"), event("d", "2026-09-26"),
        event("e", "2026-09-27"),
      ],
    });
  };

  const result = await fetchEvents(
    { start: "2026-09-25", end: "2026-09-27", include_recurring: true },
    { fetchImpl },
  );

  assert.equal(result.complete, true);
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(result.meta.api_total_hits, 5);
  assert.equal(result.meta.returned, 5);
});

test("tar med evenemang som började tidigare men pågår under sökperioden", async () => {
  const fetchImpl = async () => Response.json({
    searchInfo: { count: 12, totalHits: 3 },
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
