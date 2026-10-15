#!/usr/bin/env node
// A small stand-in for a Redmine server, for manual checks of the app and for automated tests.
// It has no dependencies and, like real Redmine servers, sends no CORS headers.
//
//   node scripts/dev/mock-redmine.mjs [--port 8123] [--host 127.0.0.1] [--delay-ms 31000]
//
// Endpoints (Redmine REST API subset the app uses):
//   GET /users/current.json   Basic alice:secret, or X-Redmine-API-Key: <API_KEY>; anything else gets 401
//   GET /issues.json          130 open issues assigned to the user; limit/offset paging, due_date and sort filters
//   GET /time_entries.json    the user's time entries of the last 60 days; limit/offset paging, from/to and issue_id filters
//   GET /issues/<id>.json     one issue, with ?include=journals,attachments,children,relations; 404 for an id that does not exist
//   GET /time_entries/<id>.json   one time entry; 404 for an id that does not exist
//   GET /issue_statuses.json, /trackers.json, /enumerations/issue_priorities.json   the names that journals refer to by id
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
const STATUSES = [
  { id: 1, name: 'New', is_closed: false },
  { id: 2, name: 'In progress', is_closed: false },
  { id: 3, name: 'Resolved', is_closed: false },
  { id: 5, name: 'Closed', is_closed: true },
];
const PEOPLE = [
  { id: 1, name: 'Alice Example' },
  { id: 2, name: 'Bob Builder' },
  { id: 3, name: 'Carol Tester' },
];

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

/**
 * One issue as `GET /issues/<id>.json` gives it. What `include` asks for is added by the caller. The data depends on
 * the id, so there are issues with and without each part: every third has a history, every fourth an attachment,
 * every fifth a relation, every seventh a subtask. The description holds markup on purpose: the app shows text.
 */
export function buildIssueDetails(issue, today, timeEntries) {
  const id = issue.id;
  const spent = timeEntries.filter((entry) => entry.issue.id === id).reduce((sum, entry) => sum + entry.hours, 0);
  const at = (offset, time) => `${dayOffset(today, offset)}T${time}Z`;
  return {
    ...issue,
    author: PEOPLE[1],
    assigned_to: PEOPLE[0],
    ...(id % 2 === 1 ? { category: { id: 1, name: 'Backend' } } : {}),
    ...(id % 3 === 0 ? { fixed_version: { id: 1, name: '1.0' } } : {}),
    description: `Steps for task ${id}:\n\n1. Open the page\n2. Press the button\n\nExpected: it works.\nSee <b>not bold</b> and <script>alert(1)</script>`,
    is_private: false,
    estimated_hours: id % 3 === 0 ? 8 : null,
    spent_hours: spent,
    total_spent_hours: spent,
    created_on: at(-20, '09:00:00'),
    updated_on: at(-2, '15:30:00'),
    closed_on: null,
    custom_fields: [{ id: 1, name: 'Customer', value: 'ACME' }],
    journals:
      id % 3 === 0
        ? [
            { id: id * 10 + 1, user: PEOPLE[1], notes: 'Can you have a look at this?', created_on: at(-10, '10:00:00'), private_notes: false, details: [] },
            {
              id: id * 10 + 2,
              user: PEOPLE[0],
              notes: '',
              created_on: at(-6, '11:15:00'),
              private_notes: false,
              details: [
                { property: 'attr', name: 'status_id', old_value: '1', new_value: '2' },
                { property: 'attr', name: 'done_ratio', old_value: '0', new_value: '40' },
                { property: 'attr', name: 'assigned_to_id', old_value: '2', new_value: '1' },
              ],
            },
            {
              id: id * 10 + 3,
              user: PEOPLE[0],
              notes: 'Fixed in the next build.\n\nSee <b>not bold</b>',
              created_on: at(-2, '15:30:00'),
              private_notes: false,
              details: [
                { property: 'attr', name: 'priority_id', old_value: '2', new_value: '4' },
                { property: 'cf', name: '1', old_value: 'ACME', new_value: 'ACME Corp' },
                { property: 'attachment', name: '7', old_value: null, new_value: 'screenshot.png' },
              ],
            },
          ]
        : [],
    attachments:
      id % 4 === 0
        ? [
            {
              id: id * 10,
              filename: 'screenshot.png',
              filesize: 48_213,
              content_type: 'image/png',
              description: 'What the page looks like',
              content_url: `/attachments/download/${id * 10}/screenshot.png`,
              author: PEOPLE[1],
              created_on: at(-10, '10:00:00'),
            },
          ]
        : [],
    children: id % 7 === 0 && id < ISSUE_COUNT ? [{ id: id + 1, tracker: issue.tracker, subject: `Task ${id + 1}` }] : [],
    relations: id % 5 === 0 && id + 2 <= ISSUE_COUNT ? [{ id, issue_id: id, issue_to_id: id + 2, relation_type: 'relates', delay: null }] : [],
  };
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
      created_on: `${spentOn}T17:00:00Z`,
      updated_on: `${spentOn}T17:00:00Z`,
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
      const issueId = query.get('issue_id');
      let list = timeEntries.filter((entry) => entry.spent_on >= from && entry.spent_on <= to);
      if (issueId) list = list.filter((entry) => entry.issue.id === Number(issueId));
      if (query.get('sort') === 'spent_on:desc') list = [...list].sort((a, b) => (a.spent_on < b.spent_on ? 1 : a.spent_on > b.spent_on ? -1 : b.id - a.id));
      sendJson(response, 200, page(list, query, 'time_entries'));
    } else if (/^\/issues\/\d+\.json$/.test(pathname)) {
      const issue = issues.find((candidate) => candidate.id === Number(pathname.match(/\d+/)[0]));
      if (!issue) return void response.writeHead(404).end();
      const details = buildIssueDetails(issue, today, timeEntries);
      const included = new Set((query.get('include') ?? '').split(','));
      for (const part of ['journals', 'attachments', 'children', 'relations']) if (!included.has(part)) delete details[part];
      sendJson(response, 200, { issue: details });
    } else if (/^\/time_entries\/\d+\.json$/.test(pathname)) {
      const entry = timeEntries.find((candidate) => candidate.id === Number(pathname.match(/\d+/)[0]));
      if (!entry) return void response.writeHead(404).end();
      sendJson(response, 200, { time_entry: entry });
    } else if (pathname === '/issue_statuses.json') {
      sendJson(response, 200, { issue_statuses: STATUSES });
    } else if (pathname === '/trackers.json') {
      sendJson(response, 200, { trackers: TRACKERS });
    } else if (pathname === '/enumerations/issue_priorities.json') {
      sendJson(response, 200, { issue_priorities: PRIORITIES.map((priority) => ({ ...priority, is_default: priority.id === 2, active: true })) });
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
