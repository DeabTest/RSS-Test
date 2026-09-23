import assert from "node:assert/strict";
import test from "node:test";
import { fetchEvents } from "../netlify/functions/event-service.mjs";

function event(id, start, title = `Evenemang ${id}`) {
  return {
    id,
    title,
    uri: `/evenemang/${id}`,
    info: { start, end: start, location: { name: "Eskilstuna" } },
  };
}

test("hämtar första och sista kumulativa sidan, tar bort dubbletter och datumfiltrerar", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    calls.push(page);
    const hits = page === 1
      ? [event("a", "2026-07-22T10:00:00"), event("b", "2026-08-01T10:00:00")]
      : [
          event("a", "2026-07-22T10:00:00"),
          event("b", "2026-08-01T10:00:00"),
          event("c", "2026-09-01T10:00:00"),
          event("c", "2026-09-01T10:00:00"),
        ];
    return Response.json({ searchInfo: { count: hits.length, totalHits: 13 }, hits });
  };

  const result = await fetchEvents(
    { start: "2026-07-22", end: "2026-08-31", include_recurring: false },
    { fetchImpl, now: () => new Date("2026-07-22T12:00:00Z") },
  );

  assert.equal(result.complete, true);
  assert.deepEqual(calls.sort(), [1, 2]);
  assert.equal(result.meta.fetched_unique, 3);
  assert.equal(result.meta.returned, 2);
  assert.deepEqual(result.events.map(({ id }) => id), ["a", "b"]);
});

test("stoppar om sista kumulativa sidan saknar träffar", async () => {
  const fetchImpl = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    const hits = page === 1
      ? [event("a", "2026-07-22")]
      : [event("a", "2026-07-22"), event("b", "2026-07-23")];
    return Response.json({ searchInfo: { count: hits.length, totalHits: 13 }, hits });
  };

  const result = await fetchEvents(
    { start: "2026-07-01", end: "2026-07-31", include_recurring: true },
    { fetchImpl },
  );

  assert.equal(result.complete, false);
  assert.equal(result.status, "blocked");
  assert.match(result.error, /2 av 3 förväntade träffar/);
});

test("släpper aldrig igenom en ofullständig hämtning", async () => {
  let pageTwoAttempts = 0;
  const fetchImpl = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    if (page === 1) {
      return Response.json({ searchInfo: { count: 1, totalHits: 13 }, hits: [event("a", "2026-07-22")] });
    }
    pageTwoAttempts += 1;
    return new Response("fel", { status: 500, statusText: "Internal Server Error" });
  };

  const result = await fetchEvents(
    { start: "2026-07-01", end: "2026-07-31", include_recurring: true },
    { fetchImpl },
  );

  assert.equal(pageTwoAttempts, 3);
  assert.equal(result.complete, false);
  assert.equal(result.status, "blocked");
  assert.match(result.error, /API-sida 2.*3 försök/);
  assert.equal("events" in result, false);
});
