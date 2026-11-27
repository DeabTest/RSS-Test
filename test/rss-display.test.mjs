import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { handler } from "../netlify/functions/rss-proxy.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]+?)<\/script>/)[1];
const welcome = "VÄLKOMMEN TILL ESKILSTUNA";
const rotation = 10_000;
const retry = 60_000;
const refresh = 60 * 60_000;

function feed(...titles) {
  return { titles };
}

async function openDisplay(responses) {
  const heading = { textContent: "" };
  const timeouts = new Map();
  const intervals = new Map();
  let lastTimer = 0;
  let fetches = 0;

  const display = {
    get title() { return heading.textContent; },
    get fetches() { return fetches; },
    rotate() {
      assert.equal(intervals.size, 1);
      const [timer] = intervals.values();
      assert.equal(timer.delay, rotation);
      timer.callback();
    },
    get rotates() { return intervals.size > 0; },
    refresh(delay) {
      assert.equal(timeouts.size, 1);
      const [[id, timer]] = timeouts;
      assert.equal(timer.delay, delay);
      timeouts.delete(id);
      return timer.callback();
    },
  };

  function registerTimer(timers, callback, delay) {
    const id = ++lastTimer;
    timers.set(id, { callback, delay });
    return id;
  }

  await runInNewContext(script, {
    AbortController,
    console: { error() {} },
    document: {
      getElementById: () => heading,
      createElement: () => ({ set innerHTML(value) { this.value = value; } }),
    },
    DOMParser: class {
      parseFromString() {
        const reply = responses[fetches - 1];
        const items = (reply.titles ?? []).map((title) => ({
          getElementsByTagName: () => [{ textContent: title }],
        }));
        const channel = { getElementsByTagName: () => items };
        return {
          querySelector(selector) {
            if (selector === "parsererror") return reply.invalidXml ? {} : null;
            if (selector === "rss > channel") return reply.titles ? channel : null;
            throw new Error(`Oväntad selektor ${selector}`);
          },
        };
      }
    },
    async fetch() {
      const reply = responses[fetches++];
      assert.ok(reply, "Oväntat RSS-anrop");
      return new Response("testflöde", { status: reply.status ?? 200 });
    },
    setTimeout: (callback, delay) => registerTimer(timeouts, callback, delay),
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (callback, delay) => registerTimer(intervals, callback, delay),
    clearInterval: (id) => intervals.delete(id),
  });
  return display;
}

test("fortsätter visa evenemang och gör nytt försök efter serverfel och ogiltig XML", async () => {
  const display = await openDisplay([
    feed("Första", "Andra", "Tredje"),
    { status: 502 },
    { invalidXml: true, titles: ["Felsvar"] },
    feed("Nytt evenemang"),
  ]);
  assert.equal(display.title, "Första");
  await display.refresh(refresh);
  assert.equal(display.title, "Första");
  display.rotate();
  assert.equal(display.title, "Andra");
  await display.refresh(retry);
  assert.equal(display.title, "Andra");
  display.rotate();
  assert.equal(display.title, "Tredje");
  await display.refresh(retry);
  assert.equal(display.title, "Nytt evenemang");
  assert.equal(display.fetches, 4);
});

test("visar välkomsttexten och stoppar rotationen vid ett giltigt tomt flöde", async () => {
  const display = await openDisplay([feed("Tidigare evenemang"), feed(), feed("Nytt evenemang")]);
  await display.refresh(refresh);
  assert.equal(display.title, welcome);
  assert.equal(display.rotates, false);
  await display.refresh(refresh);
  assert.equal(display.title, "Nytt evenemang");
  assert.equal(display.rotates, true);
});

test("visar välkomsttexten vid fel när visningen saknar evenemang", async () => {
  const display = await openDisplay([{ missingChannel: true }, feed("Första evenemanget")]);
  assert.equal(display.title, welcome);
  assert.equal(display.rotates, false);
  await display.refresh(retry);
  assert.equal(display.title, "Första evenemanget");
});

test("behåller den visade titeln och fortsätter växla när listan krymper", async () => {
  const display = await openDisplay([
    feed("Första", "Andra", "Tredje", "Fjärde"),
    feed("Tredje", "Fjärde"),
  ]);
  display.rotate();
  display.rotate();
  assert.equal(display.title, "Tredje");
  await display.refresh(refresh);
  assert.equal(display.title, "Tredje");
  display.rotate();
  assert.equal(display.title, "Fjärde");
  display.rotate();
  assert.equal(display.title, "Tredje");
});

test("RSS-proxyn skickar ett läsbart fel när källan svarar med serverfel", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Felsvar</html>", { status: 503 }));
  t.mock.method(console, "error", () => {});

  const result = await handler();
  assert.equal(result.statusCode, 502);
  assert.equal(result.headers["Access-Control-Allow-Origin"], "*");
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.match(result.headers["Content-Type"], /text\/plain/);
});
