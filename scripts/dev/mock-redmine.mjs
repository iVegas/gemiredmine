#!/usr/bin/env node
// A small stand-in for a Redmine server, for manual checks of the app and for automated tests.
// It has no dependencies and, like real Redmine servers, sends no CORS headers.
//
//   node scripts/dev/mock-redmine.mjs [--port 8123] [--host 127.0.0.1] [--delay-ms 31000]
//
// Endpoints (Redmine REST API subset the app uses):
//   GET /users/current.json   Basic alice:secret, or X-Redmine-API-Key: <API_KEY>; anything else gets 401
//   GET /issues.json          130 open issues assigned to the user; limit/offset paging, due_date and sort filters
//   GET /time_entries.json    the user's time entries of the last 60 days; limit/offset paging, from/to filters
//
// Path prefixes turn the same server into a special one, so a base URL such as
// http://127.0.0.1:8123/moved selects the behaviour:
//   /moved/*  301 to https://elsewhere.example/<rest>      (the server changed address)
//   /sso/*    302 to a login page that does not contain <rest>   (a proxy or single sign-on gateway)
//   /slow/*   answers like the plain server, after --delay-ms
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const USERNAME = 'alice';
export const PASSWORD = 'secret';
/** The API key Redmine hands out for the account; 40 hex characters like the real thing. */
export const API_KEY = '0123456789abcdef0123456789abcdef01234567';
export const ISSUE_COUNT = 130;

const USER = Object.freeze({
  id: 1,
  login: USERNAME,
  firstname: 'Alice',
  lastname: 'Example',
  mail: 'alice@example.test',
  api_key: API_KEY,
});

const PROJECTS = [
  { id: 1, name: 'Website' },
  { id: 2, name: 'Mobile app' },
  { id: 3, name: 'Infrastructure' },
];
const TRACKERS = [
  { id: 1, name: 'Bug' },
  { id: 2, name: 'Feature' },
  { id: 3, name: 'Support' },
];
// Redmine orders priorities by position; a higher id is a higher priority here.
const PRIORITIES = [
  { id: 1, name: 'Low' },
  { id: 2, name: 'Normal' },
  { id: 3, name: 'High' },
  { id: 4, name: 'Urgent' },
  { id: 5, name: 'Immediate' },
];
const ACTIVITIES = [
  { id: 8, name: 'Development' },
  { id: 9, name: 'Design' },
  { id: 10, name: 'Testing' },
];
const OPEN_STATUS = { id: 1, name: 'New' };

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD, `offset` days away from `today`. */
function dayOffset(today, offset) {
  return new Date(Date.parse(`${today}T00:00:00.000Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

/** 130 open issues. Some are overdue, some have no due date, so the to-do list and calendar have something to show. */
export function buildIssues(today) {
  return Array.from({ length: ISSUE_COUNT }, (_, index) => {
    const id = index + 1;
    return {
      id,
      project: PROJECTS[index % PROJECTS.length],
      tracker: TRACKERS[index % TRACKERS.length],
      status: OPEN_STATUS,
      priority: PRIORITIES[index % PRIORITIES.length],
      subject: `Task ${id}`,
      start_date: dayOffset(today, -14),
      due_date: id % 10 === 0 ? null : dayOffset(today, (index % 21) - 7),
      done_ratio: (index % 5) * 20,
    };
  });
}

/** Weekday time entries for the 60 days up to and including `today`. */
export function buildTimeEntries(today) {
  const entries = [];
  let id = 1;
  for (let back = 60; back >= 0; back--) {
    const spentOn = dayOffset(today, -back);
    const weekday = new Date(`${spentOn}T00:00:00.000Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    entries.push({
      id: id++,
      project: PROJECTS[back % PROJECTS.length],
      issue: { id: (back % ISSUE_COUNT) + 1 },
      user: { id: USER.id, name: `${USER.firstname} ${USER.lastname}` },
      activity: ACTIVITIES[back % ACTIVITIES.length],
      hours: 2 + (back % 7),
      comments: `Work on task ${(back % ISSUE_COUNT) + 1}`,
      spent_on: spentOn,
    });
  }
  return entries;
}

function authenticated(request) {
  if (request.headers['x-redmine-api-key'] === API_KEY) return true;
  const header = request.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) return false;
  return Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8') === `${USERNAME}:${PASSWORD}`;
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

/** limit/offset paging as Redmine does it: total_count is the size of the whole filtered list. */
function page(items, query, key) {
  const limit = Math.min(Number(query.get('limit')) || 25, 100);
  const offset = Number(query.get('offset')) || 0;
  return { [key]: items.slice(offset, offset + limit), total_count: items.length, offset, limit };
}

/** Redmine's `><from|to` range filter. */
function inRange(value, filter) {
  const match = /^><(\d{4}-\d{2}-\d{2})\|(\d{4}-\d{2}-\d{2})$/.exec(filter);
  return match !== null && value !== null && value >= match[1] && value <= match[2];
}

/**
 * Creates the server without starting it.
 * @param {{ delayMs?: number, today?: string }} [options]  `today` (YYYY-MM-DD) fixes the date the data is built around.
 */
export function createMockRedmine({ delayMs = 31_000, today = new Date().toISOString().slice(0, 10) } = {}) {
  const issues = buildIssues(today);
  const timeEntries = buildTimeEntries(today);

  function handle(request, response, pathname, query) {
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return;
    }
    if (!authenticated(request)) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Redmine API"' }).end();
      return;
    }

    if (pathname === '/users/current.json') {
      sendJson(response, 200, { user: USER });
    } else if (pathname === '/issues.json') {
      let list = issues;
      const due = query.get('due_date');
      if (due) list = list.filter((issue) => inRange(issue.due_date, due));
      if (query.get('sort') === 'priority:desc') {
        list = [...list].sort((a, b) => b.priority.id - a.priority.id || a.id - b.id);
      }
      sendJson(response, 200, page(list, query, 'issues'));
    } else if (pathname === '/time_entries.json') {
      const from = query.get('from') ?? '0000-01-01';
      const to = query.get('to') ?? '9999-12-31';
      sendJson(response, 200, page(timeEntries.filter((entry) => entry.spent_on >= from && entry.spent_on <= to), query, 'time_entries'));
    } else {
      response.writeHead(404).end();
    }
  }

  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://mock-redmine.invalid');
    const prefixed = /^\/(moved|sso|slow)(\/.*)$/.exec(url.pathname);
    const [, prefix, rest] = prefixed ?? [];

    if (prefix === 'moved') {
      response.writeHead(301, { Location: `https://elsewhere.example${rest}${url.search}` }).end();
    } else if (prefix === 'sso') {
      response.writeHead(302, { Location: `https://sso.example/auth?next=${encodeURIComponent('/')}` }).end();
    } else if (prefix === 'slow') {
      // Stop waiting when the client gives up, so a timed-out request does not keep the server busy.
      const timer = setTimeout(() => handle(request, response, rest, url.searchParams), delayMs);
      response.on('close', () => clearTimeout(timer));
    } else {
      handle(request, response, url.pathname, url.searchParams);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '8123' },
      host: { type: 'string', default: '127.0.0.1' },
      'delay-ms': { type: 'string', default: '31000' },
    },
  });
  const port = Number(values.port);
  const server = createMockRedmine({ delayMs: Number(values['delay-ms']) });
  server.listen(port, values.host, () => {
    const base = `http://${values.host}:${port}`;
    console.log(`Mock Redmine listening on ${base}`);
    console.log(`  Sign in as ${USERNAME} / ${PASSWORD}, or add the server with the API key ${API_KEY}`);
    console.log(`  ${base}/moved   answers 301 (the server changed address)`);
    console.log(`  ${base}/sso     answers 302 to a login page`);
    console.log(`  ${base}/slow    answers after ${values['delay-ms']} ms`);
  });
}
